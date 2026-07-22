/**
 * ChronoballBall - Handles player-facing ball actions (throw, pass, pickup, drop)
 * and roll/DC logic. GM-side execution is in ball-execute.js.
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballInterception } from './interception.js';
import { ChronoballUtils, SOCKET_TIMEOUT_SHORT_MS } from './utils.js';
import { ChronoballRolls } from './rolls.js';

export class ChronoballBall {
  static initialize() {
    ChronoballUtils.log('Chronoball | Ball mechanics initialized');
  }

  /**
   * Throw ball to a location
   */
  static async throwBall() {
    // Validate
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }

    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }

    const state = ChronoballState.getMatchState();
    if (state.carrierId !== controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotCarrier'));
      return;
    }

    // Validate thrower belongs to attacking team
    const throwerTeam = ChronoballState.getTeamAssignment(controlled.actor.id);
    if (throwerTeam !== state.attackingTeam) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotAttackingTeam'));
      return;
    }

    // Get target location FIRST
    const target = await this.getTargetLocation();
    if (!target) return;

    const distance = ChronoballUtils.calculateDistance(controlled, target);
    const rules = ChronoballState.getRules();
    const limits = ChronoballState.getMovementLimits();

    // Check throw limit (0 means unlimited)
    if (limits.throw > 0 && distance > state.remainingThrow) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.ExceedsLimit'));
      return;
    }

    // Check for interception at thrower AFTER target selection
    const interceptedAtThrower = await ChronoballInterception.checkInterceptionAtThrower(controlled);
    if (interceptedAtThrower) {
      return; // Interception successful, stop throw
    }

    // Calculate DC
    const dc = this.calculateDC(distance, rules);

    // Choose skill
    const skill = await this.chooseSkill();
    if (!skill) return;

    // Roll
    const rollResult = await this.performRoll(controlled.actor, skill, dc);
    if (!rollResult) return;

    // Execute via socket
    await ChronoballSocket.executeAsGM('throwBall', {
      tokenId: controlled.id,
      targetX: target.x,
      targetY: target.y,
      skill,
      distance,
      dc,
      rollTotal: rollResult.roll.total,
      success: rollResult.success,
      modification: rollResult.modification
    });
  }

  /**
   * Pass ball to another token
   */
  static async passBall() {
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }

    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }

    const state = ChronoballState.getMatchState();
    if (state.carrierId !== controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotCarrier'));
      return;
    }

    // Validate passer belongs to attacking team
    const passerTeam = ChronoballState.getTeamAssignment(controlled.actor.id);
    if (passerTeam !== state.attackingTeam) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotAttackingTeam'));
      return;
    }

    // Get targeted token FIRST
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.TargetFirst'));
      return;
    }

    if (targets.length > 1) {
      ui.notifications.warn(game.i18n.localize('CHRONOBALL.Errors.MultipleTargets'));
    }

    const targetToken = targets[0];

    if (!targetToken) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoTarget'));
      return;
    }

    // Don't allow passing to self
    if (targetToken.id === controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.CannotPassToSelf'));
      return;
    }

    // Don't allow passing to opposing team
    const targetTeam = ChronoballState.getTeamAssignment(targetToken.actor?.id);
    if (targetTeam && targetTeam !== passerTeam) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.CannotPassToOpponent'));
      return;
    }

    const distance = ChronoballUtils.calculateDistance(controlled, targetToken);
    const rules = ChronoballState.getRules();
    const limits = ChronoballState.getMovementLimits();

    // Check throw limit (0 means unlimited)
    if (limits.throw > 0 && distance > state.remainingThrow) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.ExceedsLimit'));
      return;
    }

    // Check for interception at thrower AFTER target selection
    const interceptedAtThrower = await ChronoballInterception.checkInterceptionAtThrower(controlled);
    if (interceptedAtThrower) {
      return; // Interception successful, stop pass
    }

    // Calculate DC
    const dc = this.calculateDC(distance, rules);

    // Choose skill
    const skill = await this.chooseSkill();
    if (!skill) return;

    // Roll
    const rollResult = await this.performRoll(controlled.actor, skill, dc);
    if (!rollResult) return;

    // Execute via socket (interception at receiver will be checked there)
    await ChronoballSocket.executeAsGM('passBall', {
      tokenId: controlled.id,
      targetTokenId: targetToken.id,
      skill,
      distance,
      dc,
      rollTotal: rollResult.roll.total,
      success: rollResult.success,
      modification: rollResult.modification
    });
  }

  /**
   * Pick up ball
   */
  static async pickupBall() {
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }

    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }

    const ballToken = ChronoballState.getBallToken();
    if (!ballToken) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoBall'));
      return;
    }

    // Check if token is adjacent to ball
    const distance = ChronoballUtils.calculateDistance(controlled, ballToken);
    if (distance > 5) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.InvalidTarget'));
      return;
    }

    // Execute via socket
    await ChronoballSocket.executeAsGM('pickupBall', {
      tokenId: controlled.id
    });
  }

  /**
   * Drop ball
   */
  static async dropBall() {
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }

    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }

    const state = ChronoballState.getMatchState();
    if (state.carrierId !== controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotCarrier'));
      return;
    }

    // Get target location within 5ft
    ui.notifications.info(game.i18n.localize('CHRONOBALL.Notifications.ClickToDrop'));
    const target = await this.getTargetLocationWithinRadius(controlled, 5);
    if (!target) {
      ui.notifications.warn(game.i18n.localize('CHRONOBALL.Notifications.DropCancelled'));
      return;
    }

    // Execute via socket
    await ChronoballSocket.executeAsGM('dropBall', {
      tokenId: controlled.id,
      dropX: target.x,
      dropY: target.y
    });
  }

  /**
   * Set carrier (via GM)
   */
  static async setCarrier(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }

    await ChronoballSocket.executeAsGM('setCarrier', { tokenId });
  }

  /**
   * Clear carrier (via GM)
   */
  static async clearCarrier() {
    await ChronoballSocket.executeAsGM('clearCarrier', {});
  }

  // DC and distance calculations

  static calculateDC(distance, rules) {
    const baseDC = rules.baseDC || 10;
    const stepDistance = rules.stepDistance || 10;
    const dcIncrease = rules.dcIncrease || 2;

    const steps = Math.floor(distance / stepDistance);
    return baseDC + (steps * dcIncrease);
  }

  // Canvas interaction

  static async getTargetLocation() {
    return new Promise((resolve) => {
      const stage = canvas.stage ?? canvas.app?.stage;
      if (!stage) {
        resolve(null);
        return;
      }

      // Ensure pointer events are enabled on the stage (Pixi v7+ uses eventMode)
      if (!stage.eventMode) stage.eventMode = 'static';

      let resolved = false;
      const cleanup = () => {
        stage.off('pointerdown', handler);
        stage.off('click', handler);
      };

      const handler = (event) => {
        if (resolved) return;
        resolved = true;
        // Pixi v7 (Foundry v13): event.getLocalPosition(); Pixi v5/v6: event.data.getLocalPosition()
        let pos;
        if (event?.getLocalPosition) {
          pos = event.getLocalPosition(stage);
        } else if (event?.data?.getLocalPosition) {
          pos = event.data.getLocalPosition(stage);
        } else {
          pos = canvas.mousePosition;
        }

        cleanup();

        resolve(pos ? { x: pos.x, y: pos.y } : null);
      };

      stage.on('pointerdown', handler);
      stage.on('click', handler);
      ui.notifications.info(game.i18n.localize('CHRONOBALL.Notifications.ClickToTarget'));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(null);
      }, SOCKET_TIMEOUT_SHORT_MS);
    });
  }

  static async getTargetLocationWithinRadius(token, radiusFeet) {
    return new Promise((resolve) => {
      const stage = canvas.stage ?? canvas.app?.stage;
      if (!stage) {
        resolve(null);
        return;
      }

      if (!stage.eventMode) stage.eventMode = 'static';

      const gridSize = canvas.grid.size;
      const gridDistance = canvas.grid.distance;
      const radiusPixels = (radiusFeet / gridDistance) * gridSize;

      let resolved = false;
      const cleanup = () => {
        stage.off('pointerdown', handler);
        stage.off('click', handler);
      };

      const handler = (event) => {
        if (resolved) return;
        // Get canvas position from mouse event (Pixi v7 / v5+v6 / fallback)
        let pos;
        if (event?.getLocalPosition) {
          pos = event.getLocalPosition(stage);
        } else if (event?.data?.getLocalPosition) {
          pos = event.data.getLocalPosition(stage);
        } else {
          pos = canvas.mousePosition;
        }

        if (pos) {
          // Calculate distance from token center
          const tokenCenterX = token.x + (token.w / 2);
          const tokenCenterY = token.y + (token.h / 2);
          const dx = pos.x - tokenCenterX;
          const dy = pos.y - tokenCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance <= radiusPixels) {
            resolved = true;
            cleanup();
            resolve({ x: pos.x, y: pos.y });
          } else {
            ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.TooFar', { distance: radiusFeet }));
          }
        }
      };

      stage.on('pointerdown', handler);
      stage.on('click', handler);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(null);
      }, SOCKET_TIMEOUT_SHORT_MS);
    });
  }

  // Roll logic

  static async chooseSkill() {
    const skills = this.getAvailableSkills();

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('CHRONOBALL.Chat.SkillChoice') },
      content: `
        <form>
          <div class="form-group">
            <label>${game.i18n.localize('CHRONOBALL.Chat.ChooseSkill')}</label>
            <select name="skill">
              ${skills.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
            </select>
          </div>
        </form>
      `,
      buttons: [
        { action: 'ok', label: 'OK', default: true, callback: (event, button, dialog) => button.form.elements.skill.value },
        { action: 'cancel', label: 'Cancel' }
      ],
      rejectClose: false
    });
    // Cancel button or dialog closed → abort
    if (!result || result === 'cancel') return null;
    return result;
  }

  static getAvailableSkills() {
    const rules = ChronoballState.getRules();
    const skillsString = rules.availableSkills;

    if (!skillsString || typeof skillsString !== 'string') {
      return [
        { id: 'ath', label: 'Athletics' },
        { id: 'slt', label: 'Sleight of Hand' },
        { id: 'acr', label: 'Acrobatics' }
      ];
    }

    return skillsString.split(',').map(s => {
      const parts = s.trim().split(':');
      return { id: parts[0], label: parts[1] || parts[0] };
    }).filter(s => s.id && s.label);
  }

  static async performRoll(actor, skill, dc) {
    const rollFn = async () => {
      try {
        if (actor.system.skills && actor.system.skills[skill]) {
          // Use the D&D 5e roll dialog (DnD5e 4.1+ API)
          const config = { skill: skill, target: dc };
          const dialog = {};
          const message = { create: false, mode: CONST.DICE_ROLL_MODES.PRIVATE };
          const rolls = await actor.rollSkill(config, dialog, message);
          return rolls?.[0] || null;
        } else {
          // Fallback for non-dnd5e actors
          const advantage = await this.askForAdvantage();
          let formula = '1d20';
          if (advantage === 1) formula = '2d20kh';
          if (advantage === -1) formula = '2d20kl';
          return new Roll(formula).evaluate();
        }
      } catch (error) {
        console.warn('Chronoball | Roll error, using fallback 1d20:', error);
        return new Roll('1d20').evaluate();
      }
    };

    return await ChronoballRolls.performRollWithModification(rollFn, dc, game.i18n.localize('CHRONOBALL.Chat.ModifyRoll'));
  }

  static async askForAdvantage() {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('CHRONOBALL.Chat.RollModeTitle') },
      content: `<p>${game.i18n.localize('CHRONOBALL.Chat.ChooseRollMode')}</p>`,
      buttons: [
        { action: 'advantage', label: game.i18n.localize('CHRONOBALL.Chat.Advantage'), callback: () => 1 },
        { action: 'normal', label: game.i18n.localize('CHRONOBALL.Chat.Normal'), default: true, callback: () => 0 },
        { action: 'disadvantage', label: game.i18n.localize('CHRONOBALL.Chat.Disadvantage'), callback: () => -1 }
      ],
      rejectClose: false
    });
    return result ?? 0;
  }
}
