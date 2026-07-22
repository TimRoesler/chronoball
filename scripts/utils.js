/**
 * ChronoballUtils - Shared utility functions
 */

export const ANIMATION_DURATION_MS = 1500;
export const SCORE_DELAY_MS = 500;
export const START_INITIATIVE = 100;
export const SOCKET_TIMEOUT_SHORT_MS = 30000;
export const SOCKET_TIMEOUT_LONG_MS = 60000;

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
   * Resolve the Scene document the active match runs on, independent of which
   * scene the current client is viewing. This lets the host execute authoritative
   * actions while sitting on a different scene.
   * Resolution order: explicit id → scene flagged `matchActive` → active combat's
   * scene → the currently viewed scene.
   * @param {string} [sceneId] Optional explicit scene id (used by setup actions).
   * @returns {Scene|null}
   */
  static getMatchScene(sceneId) {
    if (sceneId) {
      const explicit = game.scenes?.get(sceneId);
      if (explicit) return explicit;
    }
    const ballActor = game.actors?.find(a => a.name === 'Chronoball');
    const activeSceneId = ballActor?.getFlag('chronoball', 'matchActiveSceneId');
    if (activeSceneId) {
      const scene = game.scenes?.get(activeSceneId);
      if (scene) return scene;
    }
    return canvas?.scene ?? null;
  }

  /**
   * The BaseGrid instance of the match scene (has size/distance/measurePath),
   * falling back to the active canvas grid.
   */
  static getMatchGrid() {
    return this.getMatchScene()?.grid ?? canvas?.grid ?? null;
  }

  /**
   * Return the neutral token attitude/disposition value across Foundry versions.
   */
  static getNeutralAttitude() {
    const CONSTS = (foundry?.CONST || globalThis.CONST) ?? {};
    const attitudes = CONSTS.TOKEN_ATTITUDES;
    const dispositions = CONSTS.TOKEN_DISPOSITIONS;

    if (attitudes?.NEUTRAL !== undefined) return attitudes.NEUTRAL;
    if (dispositions?.NEUTRAL !== undefined) return dispositions.NEUTRAL;
    return 0;
  }

  /**
   * Return the "hidden" display mode value for token names/bars.
   */
  static getDisplayModeNone() {
    const CONSTS = (foundry?.CONST || globalThis.CONST) ?? {};
    const displayModes = CONSTS.TOKEN_DISPLAY_MODES;
    if (displayModes?.NONE !== undefined) return displayModes.NONE;
    return 0;
  }

  /**
   * Apply stable token HUD defaults that work across v12/v13.
   */
  static applyTokenHudDefaults(tokenData) {
    const attitude = this.getNeutralAttitude();
    const displayNone = this.getDisplayModeNone();

    return {
      ...tokenData,
      attitude,
      disposition: attitude,
      displayName: displayNone,
      displayBars: displayNone
    };
  }

  /**
   * Calculate distance between two points or tokens in feet.
   * Handles both token objects and coordinate objects.
   */
  static calculateDistance(source, target) {
    try {
      const sourcePos = source.center ? source.center : {x: source.x, y: source.y};
      const targetPos = target.center ? target.center : {x: target.x, y: target.y};

      if (sourcePos.x == null || sourcePos.y == null || targetPos.x == null || targetPos.y == null) {
        console.warn("Chronoball | calculateDistance received invalid source or target", {source, target});
        return Infinity;
      }

      const grid = this.getMatchGrid() ?? canvas.grid;
      const pathData = grid.measurePath([sourcePos, targetPos]);
      const distance = Number(pathData?.distance ?? pathData ?? Infinity);

      return Math.round(distance);
    } catch (e) {
      console.error("Chronoball | Error in calculateDistance:", e, {source, target});
      return Infinity;
    }
  }

  /**
   * Calculate straight-line distance between two points or tokens in scene pixels.
   */
  static calculatePixelDistance(source, target) {
    const sourcePos = source.center ? source.center : {x: source.x, y: source.y};
    const targetPos = target.center ? target.center : {x: target.x, y: target.y};

    if (sourcePos.x == null || sourcePos.y == null || targetPos.x == null || targetPos.y == null) {
      return Infinity;
    }

    const dx = targetPos.x - sourcePos.x;
    const dy = targetPos.y - sourcePos.y;
    return Math.hypot(dx, dy);
  }

  /**
   * Convert scene pixel distance to grid distance units (typically feet).
   */
  static pixelsToGridDistance(pixels) {
    const grid = this.getMatchGrid();
    const gridSize = Number(grid?.size ?? canvas?.grid?.size ?? 0);
    const gridDistance = Number(grid?.distance ?? canvas?.grid?.distance ?? 0);
    if (!gridSize || !gridDistance) return Infinity;
    return (pixels / gridSize) * gridDistance;
  }

  /**
   * Shows a dialog to allow modification of a roll result.
   * @param {Roll} roll - The roll object.
   * @param {number} dc - The DC to beat.
   * @param {string} title - The title for the dialog.
   * @returns {Promise<{reroll: boolean, takeHigher: boolean, bonus: number, cancelled?: boolean}>}
   */
  static async askForRollModification(roll, dc, title = null) {
    title = title || game.i18n.localize('CHRONOBALL.Chat.ModifyRoll');
    const successLabel = roll.total >= dc
      ? game.i18n.localize('CHRONOBALL.Chat.Success')
      : game.i18n.localize('CHRONOBALL.Chat.Failure');
    const successText = roll.total >= dc
      ? `<span style="color: #4CAF50; font-weight: bold;">${successLabel}</span>`
      : `<span style="color: #f44336; font-weight: bold;">${successLabel}</span>`;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title },
      content: `
        <p>${game.i18n.localize('CHRONOBALL.Chat.Roll')}: ${roll.total} | ${game.i18n.localize('CHRONOBALL.Chat.DC')}: ${dc}</p>
        <p>${successText}</p>
      `,
      buttons: [
        { action: 'keep', label: game.i18n.localize('CHRONOBALL.Chat.KeepResult'), default: true, callback: () => ({ reroll: false, bonus: 0 }) },
        { action: 'rerollHigher', label: game.i18n.localize('CHRONOBALL.Chat.RerollHigher'), callback: () => ({ reroll: true, takeHigher: true, bonus: 0 }) },
        { action: 'rerollLower', label: game.i18n.localize('CHRONOBALL.Chat.RerollLower'), callback: () => ({ reroll: true, takeHigher: false, bonus: 0 }) },
        { action: 'bonus', label: game.i18n.localize('CHRONOBALL.Chat.AddBonus'), callback: async () => {
          const bonus = await this.askForBonusInput();
          return { reroll: false, bonus };
        }}
      ],
      rejectClose: false
    });
    return result ?? { reroll: false, bonus: 0, cancelled: true };
  }

  /**
   * Prompt user for a numeric bonus value via DialogV2.
   */
  static async askForBonusInput(title = null) {
    title = title || game.i18n.localize('CHRONOBALL.Chat.EnterBonus');
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: '<input type="number" name="bonus" value="0" style="width: 100%;" autofocus>',
      ok: {
        label: 'OK',
        callback: (event, button, dialog) => {
          return parseInt(button.form.elements.bonus.value) || 0;
        }
      },
      rejectClose: false
    });
    return result ?? 0;
  }

}
