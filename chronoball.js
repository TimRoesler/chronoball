/**
 * Chronoball - Main Entry Point
 * A minigame framework for turn-based ball competitions
 */

import { ChronoballSocket } from './scripts/socket.js';
import { ChronoballState } from './scripts/state.js';
import { ChronoballBall } from './scripts/ball.js';
import { ChronoballScoring } from './scripts/scoring.js';
import { ChronoballInterception } from './scripts/interception.js';
import { ChronoballRoster } from './scripts/roster.js';
import { ChronoballHUD } from './apps/hud.js';
import { ChronoballPlayerPanel } from './apps/player-panel.js';
import { ChronoballRulesPanel } from './apps/rules-panel.js';
import { ChronoballFumble } from './scripts/fumble.js';
import { ChronoballUtils } from './scripts/utils.js';

class Chronoball {
  static ID = 'chronoball';
  static SOCKET = `module.${Chronoball.ID}`;

  /**
   * Debug logging - only outputs if debugMode is enabled
   */
  static log(...args) {
    try {
      if (game.settings?.get(this.ID, 'debugMode')) {
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
      return game.settings?.get(this.ID, 'debugMode') || false;
    } catch (e) {
      return false;
    }
  }

  static initialize() {
    console.log('Chronoball | Initializing module');
    
    // Initialize subsystems
    ChronoballSocket.initialize();
    ChronoballState.initialize();
    ChronoballBall.initialize();
    ChronoballScoring.initialize();
    ChronoballInterception.initialize();
    ChronoballRoster.initialize();
    ChronoballHUD.initialize();
    ChronoballFumble.initialize();
    
    // Register settings
    this.registerSettings();
    
    // Setup hooks
    this.setupHooks();
    
    console.log('Chronoball | Module initialized');
  }
  
  static registerSettings() {
    // Debug mode
    game.settings.register(Chronoball.ID, 'debugMode', {
      name: 'Debug Mode',
      hint: 'Enable debug logging in the browser console for troubleshooting',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
      onChange: (value) => {
        console.log(`Chronoball | Debug mode ${value ? 'enabled' : 'disabled'}`);
      }
    });

    // HUD visibility per user
    game.settings.register(Chronoball.ID, 'hudVisible', {
      name: 'Show HUD',
      hint: 'Display the Chronoball HUD overlay on your screen',
      scope: 'client',
      config: true,
      type: Boolean,
      default: false,
      onChange: (value) => {
        ChronoballHUD.setVisibility(value);
      }
    });

    // Commentary visibility per user
    game.settings.register(Chronoball.ID, 'commentaryEnabled', {
      name: 'Show Commentary',
      hint: 'Display Chronoball game events and messages in the chat',
      scope: 'client',
      config: true,
      type: Boolean,
      default: true
    });
    
    // Primary GM setting with choices
    game.settings.register(Chronoball.ID, 'primaryGM', {
      name: 'Primary GM',
      hint: 'Select the primary GM for authoritative actions. Leave as "Auto" to use the first active GM.',
      scope: 'world',
      config: true,
      type: String,
      default: '',
      choices: {},
      onChange: () => {}
    });

    // Setting to allow/disallow roll modification dialogs
    game.settings.register(Chronoball.ID, 'allowRollModification', {
      name: 'CHRONOBALL.Settings.AllowRollMod.Name',
      hint: 'CHRONOBALL.Settings.AllowRollMod.Hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true
    });

    // Hidden setting to store the ball actor ID
    game.settings.register(Chronoball.ID, 'ballActorId', {
      scope: 'world',
      config: false,
      type: String,
      default: ''
    });
  }
  
  static registerMenus() {
    // Add custom UI to settings via HTML injection
    Hooks.on('renderSettingsConfig', (app, html, data) => {
      const chronoballSection = html.find(`[data-category="chronoball"]`);
      
      if (chronoballSection.length > 0) {
        // Get GM users and update the Primary GM dropdown
        const gmUsers = game.users.filter(u => u.isGM);
        const primaryGMSelect = chronoballSection.find('select[name="chronoball.primaryGM"]');
        
        if (primaryGMSelect.length > 0) {
          const currentValue = game.settings.get(Chronoball.ID, 'primaryGM');
          
          // Clear and rebuild options
          primaryGMSelect.empty();
          primaryGMSelect.append(`<option value="">Auto (First Active GM)</option>`);
          
          gmUsers.forEach(gm => {
            const selected = currentValue === gm.id ? 'selected' : '';
            primaryGMSelect.append(`<option value="${gm.id}" ${selected}>${gm.name}</option>`);
          });
          
          // Add change handler to save the selection
          primaryGMSelect.off('change').on('change', async (ev) => {
            const selectedValue = $(ev.currentTarget).val();
            await game.settings.set(Chronoball.ID, 'primaryGM', selectedValue);
            ui.notifications.info('Primary GM updated');
          });
        }
        
        // Player Panel Button (available to all users)
        const playerPanelButton = $(`
          <div class="form-group">
            <label>Player Control Panel</label>
            <button type="button" class="chronoball-open-player-panel">
              <i class="fas fa-cog"></i> Open Player Panel
            </button>
            <p class="notes">Open the Chronoball player control panel to manage teams, rosters, and game flow</p>
          </div>
        `);
        
        // Rules Panel Button
        const rulesPanelButton = $(`
          <div class="form-group">
            <label>Rules Configuration</label>
            <button type="button" class="chronoball-open-rules-panel">
              <i class="fas fa-book"></i> Open Rules Panel
            </button>
            <p class="notes">Configure Chronoball game rules, endzones, movement limits, and scoring</p>
          </div>
        `);
        
        // Insert buttons before the Primary GM setting
        const primaryGMGroup = primaryGMSelect.closest('.form-group');
        if (primaryGMGroup.length > 0) {
          primaryGMGroup.before(rulesPanelButton);
          primaryGMGroup.before(playerPanelButton);
        } else {
          // Fallback: prepend to section
          chronoballSection.prepend(rulesPanelButton);
          chronoballSection.prepend(playerPanelButton);
        }

        // Player Panel button handler
        html.find('.chronoball-open-player-panel').click((ev) => {
          ev.preventDefault();
          new ChronoballPlayerPanel().render(true);
        });
        
        // Rules Panel button handler
        html.find('.chronoball-open-rules-panel').click((ev) => {
          ev.preventDefault();
          new ChronoballRulesPanel().render(true);
        });
      }
    });
  }
  
  static _tokenPositions = {};

  static setupHooks() {
    // Ready hook
    Hooks.on('ready', () => {
      console.log('Chronoball | Ready');
      ChronoballHUD.mount();
      this.registerMenus();
      this.createMacros();
    });
    
    // Canvas ready hook
    Hooks.on('canvasReady', () => {
      ChronoballHUD.updateVisibility();
      ChronoballScoring.setupSceneHooks();
    });
    
    // Combat hooks
    Hooks.on('updateCombat', (combat, changed, options, userId) => {
      if (changed.round !== undefined && ChronoballSocket.isPrimaryGM()) {
        ChronoballState.updateState({ carrierDamageInRound: 0 });
        ChronoballUtils.log('Chronoball | New round, carrier damage reset.');
      }
      if (changed.turn !== undefined || changed.round !== undefined) {
        ChronoballState.onCombatTurnChange(combat);
        ChronoballHUD.render();
        setTimeout(() => { ChronoballHUD.render(); }, 100);
      }
    });

    // Use preUpdate to capture the state BEFORE the update
    Hooks.on('preUpdateToken', (tokenDoc, changes, options, userId) => {
        if (changes.x !== undefined || changes.y !== undefined) {
            Chronoball._tokenPositions[tokenDoc.id] = { x: tokenDoc.x, y: tokenDoc.y };
        }
    });
    
    // Token hooks
    Hooks.on('updateToken', (tokenDoc, changes, options, userId) => {
      if (options.chronoball_internal) return; // Bypass for internal updates

      if (ChronoballSocket.isPrimaryGM() && (changes.x !== undefined || changes.y !== undefined)) {

        const oldPos = Chronoball._tokenPositions[tokenDoc.id];
        if (!oldPos) return;

        const oldX = oldPos.x;
        const oldY = oldPos.y;

        // The destination is the old position combined with the changes.
        const newX = changes.x ?? oldX;
        const newY = changes.y ?? oldY;

        if (oldX === newX && oldY === newY) return;

        delete Chronoball._tokenPositions[tokenDoc.id];

        const state = ChronoballState.getMatchState();
        const isCarrier = state.carrierId === tokenDoc.id;

        if (isCarrier) {
          // Use Foundry's official grid measurement for accuracy
          const origin = {x: oldX, y: oldY};
          const destination = {x: newX, y: newY};
          const pathData = canvas.grid.measurePath([origin, destination]);
          const feetDistance = pathData.distance;

          if (feetDistance > 0) {
            ChronoballState.checkAndDeductCarrierMovement(tokenDoc, oldX, oldY, newX, newY, feetDistance);
          }
          ChronoballScoring.checkRunInScore(tokenDoc, newX, newY);
        }

        const isBall = state.ballTokenId === tokenDoc.id;
        if (isBall && !isCarrier) {
          // Don't trigger scoring if a throw is in progress (animation running)
          if (!state.throwInProgress) {
            ChronoballScoring.checkThrowScore(tokenDoc, newX, newY);
          } else {
            ChronoballUtils.log('Chronoball | Ball moved but throwInProgress is true, skipping auto-scoring');
          }
        }
      }

      // HUD automatically updates via chronoball.stateChanged hook, no manual render needed
    });
    
    // Delete token hook
    Hooks.on('deleteToken', (tokenDoc, options, userId) => {
      const state = ChronoballState.getMatchState();
      if (state.carrierId === tokenDoc.id) {
        ChronoballBall.clearCarrier();
      }
      ChronoballRoster.onTokenDeleted(tokenDoc);
    });

    // Actor pre-update hook for damage detection
    Hooks.on('preUpdateActor', (actor, changes, options, userId) => {
      if (!ChronoballSocket.isPrimaryGM()) return;
      const flatChanges = foundry.utils.flattenObject(changes);
      const hpChanged = Object.keys(flatChanges).some(k => k.startsWith('system.attributes.hp'));
      if (!hpChanged) return;
      const state = ChronoballState.getMatchState();
      if (!state.carrierId) return;
      const carrierToken = canvas.tokens.get(state.carrierId);
      if (!carrierToken || actor.id !== carrierToken.actor.id) return;
      const oldHP = actor.system.attributes.hp;
      const oldTotalHP = (oldHP.value || 0) + (oldHP.temp || 0);
      const newHPValue = foundry.utils.getProperty(changes, 'system.attributes.hp.value') ?? oldHP.value;
      const newHPTemp = foundry.utils.getProperty(changes, 'system.attributes.hp.temp') ?? oldHP.temp;
      const newTotalHP = (newHPValue || 0) + (newHPTemp || 0);
      const damageTaken = oldTotalHP - newTotalHP;
      if (damageTaken > 0) {
        ChronoballUtils.log(`Chronoball | Carrier ${actor.name} is about to take ${damageTaken} damage. Handling fumble check.`);
        ChronoballFumble.handleDamage(actor, damageTaken);
      }
    });
  }
  
  static async createMacros() {
    if (!game.user.isGM) return;
    
    const macros = [
      {
        name: 'Chronoball: Ball werfen',
        type: 'script',
        command: 'game.chronoball.throwBall();',
        img: 'icons/svg/target.svg'
      },
      {
        name: 'Chronoball: Pass',
        type: 'script',
        command: 'game.chronoball.passBall();',
        img: 'icons/svg/combat.svg'
      },
      {
        name: 'Chronoball: Ball aufnehmen',
        type: 'script',
        command: 'game.chronoball.pickupBall();',
        img: 'icons/svg/item-bag.svg'
      },
      {
        name: 'Chronoball: Ball fallen lassen',
        type: 'script',
        command: 'game.chronoball.dropBall();',
        img: 'icons/svg/falling.svg'
      }
    ];
    
    for (const macroData of macros) {
      const existing = game.macros.find(m => m.name === macroData.name);
      if (existing) {
        await existing.update(macroData);
      } else {
        await Macro.create(macroData);
      }
    }
    
    console.log('Chronoball | Macros created/updated');
  }
  
  // Public API
  static async throwBall() {
    return ChronoballBall.throwBall();
  }
  
  static async passBall() {
    return ChronoballBall.passBall();
  }
  
  static async pickupBall() {
    return ChronoballBall.pickupBall();
  }
  
  static async dropBall() {
    return ChronoballBall.dropBall();
  }
  
  static async setCarrier(tokenId) {
    return ChronoballBall.setCarrier(tokenId);
  }
  
  static async clearCarrier() {
    return ChronoballBall.clearCarrier();
  }
  
  static openPlayerPanel() {
    new ChronoballPlayerPanel().render(true);
  }
  
  static openRulesPanel() {
    new ChronoballRulesPanel().render(true);
  }
  
  /**
   * Check if commentary is enabled for current user
   */
  static isCommentaryEnabled() {
    return game.settings.get(Chronoball.ID, 'commentaryEnabled');
  }

  /**
   * Create chat message only if commentary is enabled
   */
  static async createChatMessage(data) {
    if (!this.isCommentaryEnabled()) {
      this.log('Chronoball | Commentary disabled, skipping chat message');
      return;
    }

    return await ChatMessage.create(data);
  }
}

// Initialize on hook
Hooks.once('init', () => {
  Chronoball.initialize();
  
  // Expose API
  game.chronoball = Chronoball;
  
  console.log('Chronoball | API exposed as game.chronoball');
});

export { Chronoball };