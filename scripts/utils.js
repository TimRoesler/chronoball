/**
 * ChronoballUtils - Shared utility functions
 */
export class ChronoballUtils {
  /**
   * Debug logging - only outputs if debugMode is enabled
   */
  static log(...args) {
    try {
      if (game.settings?.get('chronoball', 'debugMode')) {
        console.log(...args);
      }
    } catch (e) {
      // Setting not yet registered, skip logging
    }
  }

  /**
   * Check if debug mode is enabled
   */
  static isDebugEnabled() {
    try {
      return game.settings?.get('chronoball', 'debugMode') || false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Calculate distance between two points or tokens in feet.
   * Handles both token objects and coordinate objects.
   */
  static calculateDistance(source, target) {
    try {
      const sourcePos = source.center ? source.center : {x: source.x, y: source.y};
      const targetPos = target.center ? target.center : {x: target.x, y: target.y};

      // Ensure we have valid points to measure
      if (sourcePos.x == null || sourcePos.y == null || targetPos.x == null || targetPos.y == null) {
        console.warn("Chronoball | calculateDistance received invalid source or target", {source, target});
        return Infinity;
      }

      const pathData = canvas.grid.measurePath([sourcePos, targetPos]);
      const distance = pathData.distance;

      return Math.round(distance);
    } catch (e) {
      console.error("Chronoball | Error in calculateDistance:", e, {source, target});
      return Infinity;
    }
  }

  /**
   * Shows a dialog to allow modification of a roll result.
   * @param {Roll} roll - The roll object.
   * @param {number} dc - The DC to beat.
   * @param {string} title - The title for the dialog.
   * @returns {Promise<{reroll: boolean, takeHigher: boolean, bonus: number, cancelled?: boolean}>}
   */
  static async askForRollModification(roll, dc, title = 'Modify Roll') {
    return new Promise((resolve) => {
      new Dialog({
        title: title,
        content: `
          <p>Roll: ${roll.total} | DC: ${dc}</p>
          <p>${roll.total >= dc ? '<span style="color: #4CAF50; font-weight: bold;">Success</span>' : '<span style="color: #f44336; font-weight: bold;">Failure</span>'}</p>
        `,
        buttons: {
          keep: {
            label: 'Keep Result',
            callback: () => resolve({ reroll: false, bonus: 0 })
          },
          rerollHigher: {
            label: 'Reroll, take higher',
            callback: () => resolve({ reroll: true, takeHigher: true, bonus: 0 })
          },
          rerollLower: {
            label: 'Reroll, take lower',
            callback: () => resolve({ reroll: true, takeHigher: false, bonus: 0 })
          },
          bonus: {
            label: 'Add Bonus',
            callback: () => {
              const bonus = parseInt(prompt('Enter bonus value:', '0') || '0');
              resolve({ reroll: false, bonus: isNaN(bonus) ? 0 : bonus });
            }
          }
        },
        default: 'keep',
        close: () => resolve({ reroll: false, bonus: 0, cancelled: true })
      }).render(true);
    });
  }
}
