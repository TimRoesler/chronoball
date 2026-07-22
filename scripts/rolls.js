/**
 * ChronoballRolls - Shared roll + modification helper
 */

import { ChronoballUtils } from './utils.js';
import { ChronoballState } from './state.js';

export class ChronoballRolls {
  /**
   * Perform a roll with optional modification (reroll/bonus).
   * @param {Function} rollFn - Async function that returns a Roll object or null (if cancelled).
   * @param {number} dc - The difficulty class to beat.
   * @param {string} title - Title for the modification dialog.
   * @returns {Promise<{roll: Roll, success: boolean}|null>}
   */
  static async performRollWithModification(rollFn, dc, title) {
    let roll = await rollFn();
    if (!roll) return null;

    // Track modification metadata
    let modBonus = null;
    let modBonusOriginal = null;
    let modBonusTotal = null;
    let modRerolled = false;
    let modRerollKept = null;
    let modTakeHigher = false;
    let modOriginalTotal = null;
    let modRerollTotal = null;

    const rules = ChronoballState.getRules();
    if (rules.allowRollModification) {
      const modification = await ChronoballUtils.askForRollModification(roll, dc, title);

      if (modification.cancelled) return null;

      if (modification.reroll) {
        const newRoll = await rollFn();
        if (newRoll) {
          const newTotal = newRoll.total;
          const originalTotal = roll.total;

          modRerolled = true;
          modTakeHigher = !!modification.takeHigher;
          modOriginalTotal = originalTotal;
          modRerollTotal = newTotal;

          if (modification.takeHigher) {
            if (newTotal > originalTotal) {
              roll = newRoll;
              modRerollKept = 'new';
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledHigher', { original: originalTotal, new: newTotal }));
            } else {
              modRerollKept = 'original';
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledKeptOriginal', { original: originalTotal, new: newTotal }));
            }
          } else {
            if (newTotal < originalTotal) {
              roll = newRoll;
              modRerollKept = 'new';
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledLower', { original: originalTotal, new: newTotal }));
            } else {
              modRerollKept = 'original';
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledKeptOriginal', { original: originalTotal, new: newTotal }));
            }
          }
        }
      }

      if (modification.bonus) {
        modBonus = modification.bonus;
        modBonusOriginal = roll.total;
        const newRoll = await new Roll(`${roll.total} + ${modification.bonus}`).evaluate();
        roll = newRoll;
        modBonusTotal = roll.total;
        if (modification.bonus > 0) {
          ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.AddedBonus', { bonus: `+${modification.bonus}`, total: roll.total }));
        } else {
          ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.AddedMalus', { malus: `${modification.bonus}`, total: roll.total }));
        }
      }
    }

    return {
      roll,
      success: roll.total >= dc,
      modification: {
        bonus: modBonus,
        bonusOriginal: modBonusOriginal,
        bonusTotal: modBonusTotal,
        rerolled: modRerolled,
        rerollKept: modRerollKept,
        takeHigher: modTakeHigher,
        originalTotal: modOriginalTotal,
        rerollTotal: modRerollTotal
      }
    };
  }

  /**
   * Build modification hint HTML for chat messages.
   * @param {object|null} modification - The modification metadata object.
   * @returns {string} HTML string (empty if no modification).
   */
  static buildModificationHint(modification) {
    if (!modification) return '';

    const parts = [];

    if (modification.rerolled) {
      const arrow = modification.takeHigher ? '↑' : '↓';
      const orig = modification.originalTotal;
      const reroll = modification.rerollTotal;

      if (modification.rerollKept === 'new') {
        parts.push(game.i18n.format('CHRONOBALL.Chat.RerollKeptBetter', { arrow, orig, reroll }));
      } else {
        parts.push(game.i18n.format('CHRONOBALL.Chat.RerollKeptOriginal', { arrow, orig, reroll }));
      }
    }

    if (modification.bonus > 0) {
      parts.push(game.i18n.format('CHRONOBALL.Chat.BonusHint', { original: modification.bonusOriginal, bonus: `+${modification.bonus}`, total: modification.bonusTotal }));
    } else if (modification.bonus < 0) {
      parts.push(game.i18n.format('CHRONOBALL.Chat.MalusHint', { original: modification.bonusOriginal, malus: `${modification.bonus}`, total: modification.bonusTotal }));
    }

    if (parts.length === 0) return '';

    const text = parts.join(' | ');
    return `<p style="font-size:0.85em; color:#999; margin:2px 0 0;">${text}</p>`;
  }
}
