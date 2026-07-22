/**
 * ChronoballFumble - Handles fumbling the ball on taking damage
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils, SOCKET_TIMEOUT_LONG_MS } from './utils.js';
import { ChronoballRolls } from './rolls.js';

export class ChronoballFumble {
  static pendingFumbles = new Map();

  static initialize() {
    ChronoballUtils.log('Chronoball | Fumble system initialized');
  }

  /**
   * Handles the logic when a carrier takes damage.
   * @param {Actor5e} carrierActor The actor of the token that is the carrier.
   * @param {number} damageTaken The amount of damage taken.
   */
  static async handleDamage(carrierActor, damageTaken) {
    if (!ChronoballSocket.isAuthorizedExecutor(carrierActor)) return;
    ChronoballUtils.log(`Chronoball | [GM] handleDamage entered for ${carrierActor.name} with ${damageTaken} damage.`);

    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();
    // Use the known carrier TokenDocument (scene-independent) rather than active
    // canvas tokens, so this works even when the host views another scene.
    const carrierToken = ChronoballState.getCarrierTokenDoc();

    if (!carrierToken || carrierToken.actor?.id !== carrierActor.id) return;

    const oldDamage = state.carrierDamageInRound || 0;
    const newDamage = oldDamage + damageTaken;

    // Immediately update the damage taken this round to ensure it persists for subsequent hits.
    await ChronoballState.updateState({ carrierDamageInRound: newDamage });

    const threshold = rules.fumbleDamageThreshold || 10;
    if (threshold <= 0) return; // Avoid infinite loops

    const oldThresholdsCrossed = Math.floor(oldDamage / threshold);
    const newThresholdsCrossed = Math.floor(newDamage / threshold);

    ChronoballUtils.log(`Chronoball | [GM] Damage thresholds: Old ${oldThresholdsCrossed}, New ${newThresholdsCrossed}.`);

    if (newThresholdsCrossed > oldThresholdsCrossed) {
      for (let i = oldThresholdsCrossed; i < newThresholdsCrossed; i++) {
        const dc = (rules.fumbleStartDC || 10) + (i * (rules.fumbleDCIncrease || 2));
        ChronoballUtils.log(`Chronoball | [GM] Loop ${i}: Requesting CON save with DC ${dc}.`);

        const saveResult = await this.performFumbleSave(carrierToken, dc);

        ChronoballUtils.log(`Chronoball | [GM] Save result received:`, saveResult);
        if (saveResult && !saveResult.success) {
          ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.FumbleWithDC', { name: carrierToken.name, dc, roll: saveResult.roll.total }));
          await this.createFumbleSaveChatMessage(carrierToken, dc, saveResult.roll.total, saveResult.success, saveResult.modification);
          ChronoballSocket.executeAsGM('fumbleBall', { tokenId: carrierToken.id });
          return;
        } else if (saveResult && saveResult.success) {
          ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.HoldsOntoWithDC', { name: carrierToken.name, dc, roll: saveResult.roll.total }));
          await this.createFumbleSaveChatMessage(carrierToken, dc, saveResult.roll.total, saveResult.success, saveResult.modification);
        } else {
          console.warn('Chronoball | [GM] Fumble save was cancelled or timed out.');
          return;
        }
      }
    }
  }

  static async performFumbleSave(token, dc) {
    // Check locally: do I have this token controlled?
    const controlled = canvas.tokens.controlled.find(t => t.id === token.id);
    if (controlled) {
      ChronoballUtils.log(`Chronoball | Current user controls ${token.name}, performing local fumble save.`);
      return await this.performSaveLocal(token.actor, 'con', dc);
    }

    // Broadcast to all clients — the one controlling the token will respond
    ChronoballUtils.log(`Chronoball | Broadcasting fumble save request for ${token.name}`);
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID();
      this.pendingFumbles.set(requestId, { resolve, timeout: Date.now() + SOCKET_TIMEOUT_LONG_MS });

      game.socket.emit('module.chronoball', {
        action: 'requestFumbleSave',
        data: { requestId, tokenId: token.id, actorId: token.actor.id, dc }
      });

      setTimeout(() => {
        if (this.pendingFumbles.has(requestId)) {
          console.warn(`Chronoball | Fumble save request ${requestId} timed out.`);
          this.pendingFumbles.delete(requestId);
          resolve(null);
        }
      }, SOCKET_TIMEOUT_LONG_MS);
    });
  }

  static async performSaveLocal(actor, saveType, dc) {
    const rollFn = async () => {
      try {
        const rolls = await actor.rollSavingThrow(
          { ability: saveType, target: dc },
          {},
          { create: false, mode: CONST.DICE_ROLL_MODES.PRIVATE }
        );
        return rolls?.[0] || null;
      } catch (error) {
        return new Roll('1d20').evaluate();
      }
    };

    return await ChronoballRolls.performRollWithModification(rollFn, dc, game.i18n.localize('CHRONOBALL.Chat.ModifyRoll'));
  }


  static async handleFumbleSaveRequest(data) {
    const { requestId, actorId, dc } = data.data;
    ChronoballUtils.log(`Chronoball | [Player] Received fumble save request ${requestId} for actor ${actorId} with DC ${dc}.`);
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const saveResult = await this.performSaveLocal(actor, 'con', dc);
    if (saveResult) {
      const resultData = {
        requestId,
        result: {
          total: saveResult.roll.total,
          success: saveResult.success,
          formula: saveResult.roll.formula,
          terms: saveResult.roll.terms,
          modification: saveResult.modification
        }
      };
      ChronoballUtils.log(`Chronoball | [Player] Sending fumble save response for ${requestId}:`, resultData);
      // Send response back to GM
      game.socket.emit('module.chronoball', { action: 'fumbleSaveResponse', data: resultData });
    }
  }

  static handleFumbleSaveResponse(data) {
    const { requestId, result } = data.data;
    ChronoballUtils.log(`Chronoball | [GM] Received fumble save response for ${requestId}:`, result);
    if (this.pendingFumbles.has(requestId)) {
      const { resolve } = this.pendingFumbles.get(requestId);
      this.pendingFumbles.delete(requestId);
      if (result) {
        const rollResult = {
          roll: { total: result.total, formula: result.formula, terms: result.terms },
          success: result.success,
          modification: result.modification || null
        };
        resolve(rollResult);
      } else {
        resolve(null);
      }
    }
  }

  static async createFumbleSaveChatMessage(token, dc, rollTotal, success, modification) {
    const resultIcon = success ? '✅' : '❌';
    const resultText = success ? game.i18n.localize('CHRONOBALL.Chat.FumbleSaveHeld') : game.i18n.localize('CHRONOBALL.Chat.Fumble');
    const narrativeText = success
      ? game.i18n.format('CHRONOBALL.Chat.FumbleHeld', { name: `<strong>${token.name}</strong>` })
      : game.i18n.format('CHRONOBALL.Chat.FumbleLost', { name: `<strong>${token.name}</strong>` });
    const modHint = ChronoballRolls.buildModificationHint(modification);

    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🏈</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.FumbleSave')}</span>
        </div>
        <div class="message-body">
          <p>${narrativeText}</p>
          <p>${game.i18n.localize('CHRONOBALL.Chat.DC')} ${dc} | ${game.i18n.localize('CHRONOBALL.Chat.Roll')}: <strong>${rollTotal}</strong> | <span class="message-result ${success ? 'success' : 'failure'}">${resultIcon} ${resultText}</span></p>
          ${modHint}
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({
      content,
      speaker: { alias: 'Chronoball' }
    });
  }
}
