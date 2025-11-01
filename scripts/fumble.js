/**
 * ChronoballFumble - Handles fumbling the ball on taking damage
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils } from './utils.js';

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
    if (!game.user.isGM) return;
    ChronoballUtils.log(`Chronoball | [GM] handleDamage entered for ${carrierActor.name} with ${damageTaken} damage.`);

    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();
    const carrierToken = carrierActor.getActiveTokens().find(t => ChronoballState.isCarrier(t.id));

    if (!carrierToken) return;

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
          await this.createFumbleSaveChatMessage(carrierToken, dc, saveResult.roll.total, saveResult.success);
          ChronoballSocket.executeAsGM('fumbleBall', { tokenId: carrierToken.id });
          return;
        } else if (saveResult && saveResult.success) {
          ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.HoldsOntoWithDC', { name: carrierToken.name, dc, roll: saveResult.roll.total }));
          await this.createFumbleSaveChatMessage(carrierToken, dc, saveResult.roll.total, saveResult.success);
        } else {
          console.warn('Chronoball | [GM] Fumble save was cancelled or timed out.');
          return;
        }
      }
    }
  }

  static getTokenOwner(token) {
    const owners = Object.entries(token.actor.ownership)
      .filter(([userId, level]) => level === 3)
      .map(([userId]) => game.users.get(userId))
      .filter(user => user && user.active);
    return owners[0] || null;
  }

  static async performFumbleSave(token, dc) {
    const ownerUser = this.getTokenOwner(token);
    if (!ownerUser) {
      console.warn(`Chronoball | No owner for ${token.name}, cannot request save.`);
      return null;
    }

    // Since handleDamage is GM-only, this function is also GM-only.
    // Case 1: The GM owns the token that needs to make the save.
    if (game.user.id === ownerUser.id) {
      ChronoballUtils.log(`Chronoball | GM owns token ${token.name}, performing local save.`);
      return await this.performSaveLocal(token.actor, 'con', dc);
    }

    // Case 2: A player owns the token. Request roll from player via socket.
    ChronoballUtils.log(`Chronoball | GM requesting CON save from owner ${ownerUser.name}`);
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID();
      this.pendingFumbles.set(requestId, { resolve, timeout: Date.now() + 60000 });

      game.socket.emit('module.chronoball', {
        action: 'requestFumbleSave',
        data: {
          requestId,
          actorId: token.actor.id,
          dc,
        },
        targetUserId: ownerUser.id
      });

      setTimeout(() => {
        if (this.pendingFumbles.has(requestId)) {
          console.warn(`Chronoball | Fumble save request ${requestId} timed out.`);
          this.pendingFumbles.delete(requestId);
          resolve(null); // Resolve with null on timeout
        }
      }, 60000);
    });
  }

  static async performSaveLocal(actor, saveType, dc) {
    let roll;
    try {
      const rolls = await actor.rollSavingThrow(
        { ability: saveType, targetValue: dc },
        {}, // Show dialog for roll configuration
        { create: false }
      );
      roll = rolls?.[0] || null;
    } catch (error) {
      roll = await new Roll('1d20').evaluate();
    }
    if (!roll) return null;

    if (game.settings.get('chronoball', 'allowRollModification')) {
      const modification = await this.askForSaveModification(roll, dc);
      if (modification.reroll) {
        let newRoll;
        try {
          const newRolls = await actor.rollSavingThrow(
            { ability: saveType, targetValue: dc },
            {}, // Show dialog for roll configuration
            { create: false }
          );
          newRoll = newRolls?.[0] || null;
        } catch (error) {
          newRoll = await new Roll('1d20').evaluate();
        }
        if (newRoll) {
          if (modification.takeHigher ? newRoll.total > roll.total : newRoll.total < roll.total) {
            roll = newRoll;
          }
        }
      }

      if (modification.bonus) {
        roll._total += modification.bonus;
      }
    }

    return {
      roll,
      success: roll.total >= dc
    };
  }

  static async askForSaveModification(roll, dc) {
    return new Promise((resolve) => {
      const successText = roll.total >= dc ?
        `<span style="color: #4CAF50; font-weight: bold;">${game.i18n.localize('CHRONOBALL.Chat.Success')}</span>` :
        `<span style="color: #f44336; font-weight: bold;">${game.i18n.localize('CHRONOBALL.Chat.Failure')}</span>`;
      new Dialog({
        title: game.i18n.localize('CHRONOBALL.Chat.ModifyRoll'),
        content: `<p>${game.i18n.localize('CHRONOBALL.Chat.Roll')}: ${roll.total} | ${game.i18n.localize('CHRONOBALL.Chat.DC')}: ${dc}</p><p>${successText}</p>`,
        buttons: {
          keep: { label: game.i18n.localize('CHRONOBALL.Chat.KeepResult'), callback: () => resolve({ reroll: false, bonus: 0 }) },
          rerollHigher: { label: game.i18n.localize('CHRONOBALL.Chat.RerollHigher'), callback: () => resolve({ reroll: true, takeHigher: true, bonus: 0 }) },
          rerollLower: { label: game.i18n.localize('CHRONOBALL.Chat.RerollLower'), callback: () => resolve({ reroll: true, takeHigher: false, bonus: 0 }) },
          bonus: {
            label: game.i18n.localize('CHRONOBALL.Chat.AddBonus'),
            callback: () => {
              const bonus = parseInt(prompt(game.i18n.localize('CHRONOBALL.Chat.EnterBonus'), '0') || '0');
              resolve({ reroll: false, bonus });
            }
          }
        },
        default: 'keep'
      }).render(true);
    });
  }

  static initializeSocketListeners() {
    game.socket.on('module.chronoball', (data) => {
      if (data.action === 'requestFumbleSave' && data.targetUserId === game.user.id) {
        this.handleFumbleSaveRequest(data);
      } else if (data.action === 'fumbleSaveResponse' && game.user.isGM) {
        this.handleFumbleSaveResponse(data);
      }
    });
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
          terms: saveResult.roll.terms
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
          success: result.success
        };
        resolve(rollResult);
      } else {
        resolve(null);
      }
    }
  }

  static async createFumbleSaveChatMessage(token, dc, rollTotal, success) {
    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🏈</span>
          <span class="message-title">Fumble Save</span>
        </div>
        <div class="message-body">
          <p style="margin: 0 0 10px 0;">
            <strong>${token.name}</strong> must make a CON save to keep the ball!
          </p>
          <table class="chronoball-stats-table">
            <tr>
              <td class="stat-label">DC:</td>
              <td class="stat-value">${dc}</td>
            </tr>
            <tr>
              <td class="stat-label">Save Roll:</td>
              <td class="stat-value">${rollTotal}</td>
            </tr>
            <tr>
              <td class="stat-label">Result:</td>
              <td class="stat-value" style="font-weight: bold; color: ${success ? '#4CAF50' : '#f44336'};">
                ${success ? 'Success!' : 'FUMBLE!'}
              </td>
            </tr>
          </table>
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({
      content,
      speaker: { alias: 'Chronoball' }
    });
  }
}
