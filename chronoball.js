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

  static initialize() {
    console.log('Chronoball | Initializing module');

    // Initialize subsystems with individual error handling
    const subsystems = [
      ['Socket', () => ChronoballSocket.initialize()],
      ['State', () => ChronoballState.initialize()],
      ['Ball', () => ChronoballBall.initialize()],
      ['Scoring', () => ChronoballScoring.initialize()],
      ['Interception', () => ChronoballInterception.initialize()],
      ['Roster', () => ChronoballRoster.initialize()],
      ['HUD', () => ChronoballHUD.initialize()],
      ['Fumble', () => ChronoballFumble.initialize()]
    ];

    for (const [name, initFn] of subsystems) {
      try {
        initFn();
      } catch (error) {
        console.error(`Chronoball | Failed to initialize ${name}:`, error);
      }
    }

    // Register settings
    this.registerSettings();

    // Setup hooks
    this.setupHooks();

    console.log('Chronoball | Module initialized');
  }
  

  
  static registerSettings() {
    // Debug mode
    game.settings.register(Chronoball.ID, 'debugMode', {
      name: 'CHRONOBALL.Settings.DebugMode',
      hint: 'CHRONOBALL.Settings.DebugModeHint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
      onChange: (value) => {
        console.log(`Chronoball | Debug mode ${value ? 'enabled' : 'disabled'}`);
      }
    });



    // Hidden setting to store the ball actor ID
    game.settings.register(Chronoball.ID, 'ballActorId', {
      scope: 'world',
      config: false,
      type: String,
      default: ''
    });

    // Official settings menus (more reliable than HTML injection)
    game.settings.registerMenu(Chronoball.ID, 'playerPanel', {
      name: 'Player Control Panel',
      label: 'Open Player Panel',
      hint: 'Open the Chronoball player control panel to manage teams, rosters, and game flow',
      type: ChronoballPlayerPanel,
      restricted: false
    });

    game.settings.registerMenu(Chronoball.ID, 'rulesPanel', {
      name: 'Rules Configuration',
      label: 'Open Rules Panel',
      hint: 'Configure Chronoball game rules, endzones, movement limits, and scoring',
      type: ChronoballRulesPanel,
      restricted: true
    });
  }
  
  static _tokenPositions = {};
  static _currentAuraTokenId = null;

    static handleTokenMovement(tokenDoc, changes, oldPos) {
        if (!oldPos) return;

        const oldX = oldPos.x;
        const oldY = oldPos.y;

        const newX = changes.x ?? tokenDoc.x;
        const newY = changes.y ?? tokenDoc.y;

        if (oldX === newX && oldY === newY) return;

        delete Chronoball._tokenPositions[tokenDoc.id];

        const state = ChronoballState.getMatchState();
        const isCarrier = state.carrierId === tokenDoc.id;

        if (isCarrier) {
          const origin = {x: oldX, y: oldY};
          const destination = {x: newX, y: newY};
          const grid = ChronoballUtils.getMatchGrid() ?? canvas.grid;
          const pathData = grid.measurePath([origin, destination]);
          const feetDistance = pathData.distance;

          if (feetDistance > 0) {
            ChronoballState.checkAndDeductCarrierMovement(tokenDoc, oldX, oldY, newX, newY, feetDistance);
          }
          ChronoballScoring.checkRunInScore(tokenDoc, newX, newY);
        }

        const isBall = state.ballTokenId === tokenDoc.id;
        if (isBall && !isCarrier) {
          if (!state.throwInProgress) {
            ChronoballScoring.checkThrowScore(tokenDoc, newX, newY);
          } else {
            ChronoballUtils.log('Chronoball | Ball moved but throwInProgress is true, skipping auto-scoring');
          }
        }
    }

  static async updateActivePlayerAura(state) {
    if (!game.modules.get('sequencer')?.active) return;

    const activeTokenId = state?.turnOrder && state?.currentTurnIndex !== undefined && state?.currentTurnIndex >= 0
      ? state.turnOrder[state.currentTurnIndex]
      : null;

    if (activeTokenId === this._currentAuraTokenId) {
      return; // Turn didn't transition to a different token, skip duplicate sequence plays
    }

    console.log("Chronoball | Active player turn transitioned from", this._currentAuraTokenId, "to", activeTokenId);
    this._currentAuraTokenId = activeTokenId;

    const rules = ChronoballState.getRules();
    const auraSource = rules.activePlayerAuraSource;
    const auraScale = rules.activePlayerAuraScale || 1.5;

    console.log("Chronoball | updateActivePlayerAura called", {
      activeTokenId,
      auraSource,
      auraScale,
      turnOrder: state?.turnOrder,
      currentTurnIndex: state?.currentTurnIndex
    });

    // Always end existing active player auras first
    await Sequencer.EffectManager.endEffects({ name: 'chronoball-active-player-aura' });

    if (activeTokenId && auraSource) {
      const token = canvas.tokens?.get(activeTokenId);
      console.log("Chronoball | Active player token resolved on canvas:", !!token);
      if (token) {
        const sequence = new Sequence()
          .effect()
          .file(auraSource)
          .attachTo(token, { bindAlpha: false })
          .belowTokens(true)
          .scale(auraScale)
          .fadeIn(500)
          .fadeOut(500)
          .opacity(0.8)
          .persist()
          .name('chronoball-active-player-aura');

        try {
          await sequence.play();
          console.log("Chronoball | Sequencer active player aura played successfully on token:", token.name);
        } catch (e) {
          console.warn('Chronoball | Active player aura play failed:', e);
        }
      }
    }
  }

  static setupHooks() {
    // Ready hook
    Hooks.on('ready', () => {
      console.log('Chronoball | Ready');
      ChronoballHUD.mount();
      this.createMacros();
      // Request initial state sync from Host
      ChronoballSocket.emit('requestStateSync');
    });

    Hooks.on('chronoball.stateChanged', (state) => {
      this.updateActivePlayerAura(state);
    });
    
    // Hide commentary when no match is active on current scene
    Hooks.on('renderChatMessageHTML', (message, html) => {
      if (!ChronoballState.isMatchActiveOnCurrentScene()) {
        const el = html instanceof HTMLElement ? html : html?.[0] || html;
        if (el?.querySelector?.('.chronoball-chat-message')) {
          el.style.display = 'none';
        }
      }
    });

    // Update HUD and chat visibility on match start/end
    Hooks.on('chronoball.actionComplete', (action) => {
      if (action === 'startMatch' || action === 'endMatch') {
        ChronoballHUD.updateVisibility();
        ui.chat.scrollBottom();
        if (action === 'endMatch') {
          Chronoball._currentAuraTokenId = null;
          if (game.modules.get('sequencer')?.active) {
            Sequencer.EffectManager.endEffects({ name: 'chronoball-active-player-aura' });
          }
        }
      }
    });

    // Canvas ready hook
    Hooks.on('canvasReady', () => {
      ChronoballHUD.updateVisibility();
      this.updateActivePlayerAura(ChronoballState.getMatchState());
    });
    
    // Bypassed combat hooks (custom turn tracker is used instead)

    // Use preUpdate to capture the state BEFORE the update
    Hooks.on('preUpdateToken', (tokenDoc, changes, options, userId) => {
        if (changes.x !== undefined || changes.y !== undefined) {
            Chronoball._tokenPositions[tokenDoc.id] = { x: tokenDoc.x, y: tokenDoc.y };
        }
    });
    
    // Token hooks
    Hooks.on('updateToken', (tokenDoc, changes, options, userId) => {
      if (options.chronoball_internal) return;

      if (changes.x !== undefined || changes.y !== undefined) {
        const oldPos = Chronoball._tokenPositions[tokenDoc.id];
        if (!oldPos) return;

        if (ChronoballSocket.isPrimaryGM()) {
          Chronoball.handleTokenMovement(tokenDoc, changes, oldPos);
        } else {
          ChronoballSocket.emit('playerMovedToken', {
            tokenId: tokenDoc.id,
            changes: changes,
            oldPos: oldPos,
          });
        }
      }
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
      // Ignore HP changes the module itself makes (e.g. granting/removing the
      // carrier's temporary hit points) — those are not damage and must not
      // trigger a fumble save.
      if (options?.chronoball_internal) return;
      const flatChanges = foundry.utils.flattenObject(changes);
      const hpChanged = Object.keys(flatChanges).some(k => k.startsWith('system.attributes.hp'));
      if (!hpChanged) return;
      const state = ChronoballState.getMatchState();
      if (!state.carrierId) return;
      // Scene-independent carrier lookup so detection works on any client/scene.
      const carrierToken = ChronoballState.getCarrierTokenDoc();
      if (!carrierToken || actor.id !== carrierToken.actor?.id) return;
      const oldHP = actor.system.attributes.hp;
      const oldTotalHP = (oldHP.value || 0) + (oldHP.temp || 0);
      const newHPValue = foundry.utils.getProperty(changes, 'system.attributes.hp.value') ?? oldHP.value;
      const newHPTemp = foundry.utils.getProperty(changes, 'system.attributes.hp.temp') ?? oldHP.temp;
      const newTotalHP = (newHPValue || 0) + (newHPTemp || 0);
      const damageTaken = oldTotalHP - newTotalHP;
      if (damageTaken > 0) {
        ChronoballUtils.log(`Chronoball | Carrier ${actor.name} is about to take ${damageTaken} damage. Handling fumble check.`);

        // If we're the Primary GM, handle damage directly
        // Otherwise, send to GM via socket
        if (ChronoballSocket.isPrimaryGM()) {
          ChronoballFumble.handleDamage(actor, damageTaken);
        } else {
          ChronoballUtils.log(`Chronoball | Non-GM detected damage, sending to GM via socket`);
          ChronoballSocket.emit('handleCarrierDamage', {
            actorId: actor.id,
            damageTaken: damageTaken
          });
        }
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
        img: 'modules/chronoball/assets/icons/chrono_throw.png'
      },
      {
        name: 'Chronoball: Pass',
        type: 'script',
        command: 'game.chronoball.passBall();',
        img: 'modules/chronoball/assets/icons/chrono_pass.png'
      },
      {
        name: 'Chronoball: Ball aufnehmen',
        type: 'script',
        command: 'game.chronoball.pickupBall();',
        img: 'modules/chronoball/assets/icons/chrono_pickup.png'
      },
      {
        name: 'Chronoball: Ball fallen lassen',
        type: 'script',
        command: 'game.chronoball.dropBall();',
        img: 'modules/chronoball/assets/icons/chrono_drop.png'
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

}

// Initialize on hook
Hooks.once('init', () => {
  Chronoball.initialize();
  
  // Expose API
  game.chronoball = Chronoball;
  
  console.log('Chronoball | API exposed as game.chronoball');
});

export { Chronoball };
