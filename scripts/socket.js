/**
 * ChronoballSocket - Handles socket communication for authoritative actions.
 * Pure router — delegates all business logic to specialized modules.
 */

import { ChronoballUtils } from './utils.js';

export class ChronoballSocket {
  static SOCKET_NAME = 'module.chronoball';

  static initialize() {
    if (!game.socket) {
      ChronoballUtils.log('Chronoball | Socket not yet available, deferring to ready hook');
      Hooks.once('ready', () => this.initialize());
      return;
    }
    game.socket.on(this.SOCKET_NAME, this.onSocketMessage.bind(this));
    ChronoballUtils.log('Chronoball | Socket initialized');
  }

  /**
   * Handle incoming socket messages
   */
  static async onSocketMessage(data) {
    // Socket messages can arrive during world load, before game.actors / game.users /
    // canvas are initialized. Defer processing until the game is fully ready so handlers
    // (HUD render, isPrimaryGM, token lookups) don't read undefined collections.
    if (!game.ready) {
      Hooks.once('ready', () => this.onSocketMessage(data));
      return;
    }
    ChronoballUtils.log('Chronoball | Socket message received:', data);
    const { action, targetUserId, _targetUserId } = data;

    // Route targeted socket messages: ignore if we are not the target user
    if (_targetUserId && _targetUserId !== game.user.id) {
      return;
    }

    // Route broadcast messages: show dialog only if this client controls the token
    if (!targetUserId) {
      if (action === 'interceptionRequest' || action === 'requestSaveType' || action === 'requestSaveRoll') {
        const ChronoballInterception = (await import('./interception.js')).ChronoballInterception;
        const tokenId = action === 'interceptionRequest' ? data.data.defenderId : data.data.tokenId;
        const controlled = canvas.tokens.controlled.find(t => t.id === tokenId);
        if (!controlled) return;

        if (action === 'interceptionRequest') return ChronoballInterception.showInterceptionDialog(data.data);
        if (action === 'requestSaveType') return ChronoballInterception.handleSaveTypeRequest(data.data);
        if (action === 'requestSaveRoll') return ChronoballInterception.handleSaveRollRequest(data.data);
      }
      if (action === 'requestFumbleSave') {
        const ChronoballFumble = (await import('./fumble.js')).ChronoballFumble;
        const tokenId = data.data.tokenId;
        const controlled = canvas.tokens.controlled.find(t => t.id === tokenId);
        if (controlled) return ChronoballFumble.handleFumbleSaveRequest(data);
        return;
      }
    }

    // Handle response messages (any client with pending request can handle these)
    const ChronoballInterception = (await import('./interception.js')).ChronoballInterception;
    const ChronoballFumble = (await import('./fumble.js')).ChronoballFumble;

    switch (action) {
      case 'stateChanged': {
        const { ChronoballState } = await import('./state.js');
        ChronoballState._matchState = data.newState;
        return Hooks.callAll('chronoball.stateChanged', data.newState);
      }
      case 'requestStateSync': {
        if (this.isPrimaryGM()) {
          const { ChronoballState } = await import('./state.js');
          this.emit('stateChanged', { newState: ChronoballState.getMatchState() });
        }
        return;
      }
      case 'actionComplete':
        return Hooks.callAll('chronoball.actionComplete', data.completedAction);
      case 'interceptionResponse':
        return ChronoballInterception.handleInterceptionResponse(data.data.requestId, data.data.accepted);
      case 'saveTypeResponse':
        return ChronoballInterception.handleSaveTypeResponse(data.data);
      case 'saveRollResponse':
        return ChronoballInterception.handleSaveRollResponse(data.data);
      case 'fumbleSaveResponse':
        return ChronoballFumble.handleFumbleSaveResponse(data);
    }

    // Route GM-only messages
    // _localExecution flag is set by executeAsGM() for local dispatch (any GM)
    const isExecutor = _targetUserId ? _targetUserId === game.user.id : this.isPrimaryGM();
    if (isExecutor || data._localExecution) {
      switch (action) {
        case 'throwBall':
          return this.executeThrowBall(data);
        case 'passBall':
          return this.executePassBall(data);
        case 'pickupBall':
          return this.executePickupBall(data);
        case 'dropBall':
          return this.executeDropBall(data);
        case 'setCarrier':
          return this.executeSetCarrier(data);
        case 'clearCarrier':
          return this.executeClearCarrier(data);
        case 'updateMatchState':
          return this.executeUpdateMatchState(data);
        case 'setTeamAssignment':
          return this.executeSetTeamAssignment(data);
        case 'clearTeamAssignment':
          return this.executeClearTeamAssignment(data);
        case 'fumbleBall':
          return this.executeFumbleBall(data);
        case 'handleCarrierDamage':
          return this.executeHandleCarrierDamage(data);
        case 'interceptionTurnover':
          return this.executeInterceptionTurnover(data);
        case 'startMatch':
          return this.executeStartMatch(data);
        case 'endMatch':
          return this.executeEndMatch(data);
        case 'playerMovedToken':
          return this.executePlayerMovedToken(data);
        case 'determineTeams':
          return this.executeDetermineTeams(data);
        case 'finishTurn':
          return this.executeFinishTurn(data);
        case 'updateRules':
          return this.executeUpdateRules(data);

        default:
          if (!targetUserId) { // Avoid warning for messages intended for players
            console.warn('Chronoball | Unknown GM socket action:', action);
          }
      }
    }
  }

  /**
   * Emit a socket message
   */
  static emit(action, data = {}) {
    const payload = {
      action,
      ...data,
      userId: game.user.id,
      timestamp: Date.now()
    };

    ChronoballUtils.log('Chronoball | Emitting socket message:', payload);
    game.socket.emit(this.SOCKET_NAME, payload);
  }

  /**
   * Execute an action either locally (if GM) or via socket
   */
  static async executeAsGM(action, data = {}) {
    const executor = this.getExecutionUser(action, data);
    const isExecutor = executor.id === game.user.id;

    if (isExecutor) {
      // Execute directly — this user is the authoritative executor for this action
      return await this.onSocketMessage({ action, ...data, _localExecution: true });
    } else {
      // Send to the designated executor via socket
      this.emit(action, { ...data, _targetUserId: executor.id });
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          Hooks.off('chronoball.actionComplete', hook);
          ui.notifications.warn(game.i18n.localize('CHRONOBALL.Errors.GMTimeout'));
          resolve(false);
        }, 5000);
        const hook = Hooks.on('chronoball.actionComplete', (completedAction) => {
          if (completedAction === action) {
            clearTimeout(timeout);
            Hooks.off('chronoball.actionComplete', hook);
            resolve(true);
          }
        });
      });
    }
  }

  static isPrimaryGM() {
    const host = this.getPrimaryGM();
    const result = !!host && host.id === game.user.id;
    ChronoballUtils.log(`Chronoball | isPrimaryGM: ${result} (host: ${host?.name ?? 'none'})`);
    return result;
  }

  /**
   * Get the authoritative host user (falls back deterministically to the first active user).
   */
  static getPrimaryGM() {
    // Fallback: choose the first active user (deterministic across clients)
    const activeUsers = game.users.filter(u => u.active).sort((a, b) => a.id.localeCompare(b.id));
    return activeUsers[0] ?? null;
  }

  /**
   * Check if current client is authorized to execute a database action.
   * If a GM is active, only the Primary GM (GM client) is authorized.
   * If no GM is active, either the Primary GM (first active user) OR the owner of the document is authorized.
   */
  static isAuthorizedExecutor(doc = null) {
    const activeGM = game.users.activeGM;
    if (activeGM) {
      return this.isPrimaryGM();
    }
    if (this.isPrimaryGM()) return true;
    if (doc) {
      const actor = doc.actor || doc;
      if (actor && actor.isOwner) return true;
    }
    return false;
  }

  /**
   * Find the user client that should execute a database action.
   * If a GM is active, the GM client is always the executor.
   * If no GM is active, it routes to the owner of the document if possible.
   */
  static getExecutionUser(action, data) {
    const activeGM = game.users.activeGM;
    if (activeGM) return activeGM;

    // No GM online: route to the owner of the relevant document if possible
    let actor = null;
    if (data.tokenId) {
      const tokenDoc = ChronoballUtils.getMatchScene()?.tokens.get(data.tokenId);
      actor = tokenDoc?.actor;
    } else if (data.actorId) {
      actor = game.actors.get(data.actorId);
    } else if (action === 'clearCarrier') {
      const scene = ChronoballUtils.getMatchScene();
      const state = scene?.getFlag('chronoball', 'matchState') || {};
      if (state.carrierId) {
        const tokenDoc = scene?.tokens.get(state.carrierId);
        actor = tokenDoc?.actor;
      }
    }

    if (actor) {
      // Find an active player who is an owner of this actor. Prefer players, but fallback to GMs if no player owner is online.
      const activeOwner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ||
                          game.users.find(u => u.active && actor.testUserPermission(u, "OWNER"));
      if (activeOwner) return activeOwner;
    }

    // Default fallback: the initiator (the client that sent/triggered the action)
    const initiatorId = data.userId || game.user.id;
    return game.users.get(initiatorId) || game.user;
  }

  /**
   * Broadcast actionComplete to all clients via Hook + Socket
   */
  static broadcastActionComplete(action) {
    Hooks.callAll('chronoball.actionComplete', action);
    this.emit('actionComplete', { completedAction: action });
  }

  // Execution methods — thin wrappers that delegate to specialized modules

  static async executeThrowBall(data) {
    const { tokenId, targetX, targetY, skill, distance, dc, rollTotal, success, modification } = data;
    const { ChronoballBallExecute } = await import('./ball-execute.js');
    await ChronoballBallExecute.executeThrow(tokenId, targetX, targetY, skill, distance, dc, rollTotal, success, modification);
    this.broadcastActionComplete('throwBall');
  }

  static async executePassBall(data) {
    const { tokenId, targetTokenId, skill, distance, dc, rollTotal, success, modification } = data;
    const { ChronoballBallExecute } = await import('./ball-execute.js');
    await ChronoballBallExecute.executePass(tokenId, targetTokenId, skill, distance, dc, rollTotal, success, modification);
    this.broadcastActionComplete('passBall');
  }

  static async executePickupBall(data) {
    const { tokenId } = data;
    const { ChronoballBallExecute } = await import('./ball-execute.js');
    await ChronoballBallExecute.executePickup(tokenId);
    this.broadcastActionComplete('pickupBall');
  }

  static async executeDropBall(data) {
    const { tokenId, dropX, dropY } = data;
    const { ChronoballBallExecute } = await import('./ball-execute.js');
    await ChronoballBallExecute.executeDrop(tokenId, dropX, dropY);
    this.broadcastActionComplete('dropBall');
  }

  static async executeSetCarrier(data) {
    const { tokenId } = data;
    const { ChronoballCarrier } = await import('./carrier.js');
    await ChronoballCarrier.executeSetCarrier(tokenId);
    this.broadcastActionComplete('setCarrier');
  }

  static async executeClearCarrier(data) {
    const { ChronoballCarrier } = await import('./carrier.js');
    await ChronoballCarrier.executeClearCarrier();
    this.broadcastActionComplete('clearCarrier');
  }

  static async executeUpdateMatchState(data) {
    const { updates } = data;
    const ChronoballState = (await import('./state.js')).ChronoballState;
    await ChronoballState.updateState(updates);
    this.broadcastActionComplete('updateMatchState');
  }

  static async executeUpdateRules(data) {
    const { updates } = data;
    const ChronoballState = (await import('./state.js')).ChronoballState;
    await ChronoballState.updateRules(updates);
    this.broadcastActionComplete('updateRules');
  }

  static async executeFumbleBall(data) {
    const { tokenId } = data;
    const { ChronoballBallExecute } = await import('./ball-execute.js');
    await ChronoballBallExecute.executeFumble(tokenId);
    this.broadcastActionComplete('fumbleBall');
  }

  static async executeSetTeamAssignment(data) {
    const { actorId, team } = data;
    try {
      const { ChronoballState } = await import('./state.js');
      await ChronoballState.setTeamAssignment(actorId, team);
      this.broadcastActionComplete('setTeamAssignment');
    } catch (e) {
      console.error('Chronoball | Failed to set team assignment via GM:', e);
    }
  }

  static async executeClearTeamAssignment(data) {
    const { actorId } = data;
    try {
      const { ChronoballState } = await import('./state.js');
      await ChronoballState.clearTeamAssignment(actorId);
      this.broadcastActionComplete('clearTeamAssignment');
    } catch (e) {
      console.error('Chronoball | Failed to clear team assignment via GM:', e);
    }
  }

  static async executeHandleCarrierDamage(data) {
    const { actorId, damageTaken } = data;
    try {
      const actor = game.actors.get(actorId);
      if (!actor) {
        console.error(`Chronoball | Actor ${actorId} not found for damage handling`);
        return;
      }
      const { ChronoballFumble } = await import('./fumble.js');
      await ChronoballFumble.handleDamage(actor, damageTaken);
      ChronoballUtils.log(`Chronoball | GM handled carrier damage: ${damageTaken} for ${actor.name}`);
    } catch (e) {
      console.error('Chronoball | Failed to handle carrier damage via GM:', e);
    }
  }

  static async executeInterceptionTurnover(data) {
    const { interceptorId, interceptorTeam, location } = data;
    try {
      ChronoballUtils.log(`Chronoball | GM executing interception turnover at ${location}`);
      const { ChronoballState } = await import('./state.js');
      await ChronoballState.endPhase();
      ChronoballUtils.log(`Chronoball | Interception turnover completed successfully`);
      this.broadcastActionComplete('interceptionTurnover');
    } catch (e) {
      console.error('Chronoball | Failed to execute interception turnover via GM:', e);
    }
  }

  static async executeStartMatch(data) {
    try {
      ChronoballUtils.log(`Chronoball | GM executing start match`);
      const { ChronoballState } = await import('./state.js');
      const { ChronoballRoster } = await import('./roster.js');
      const { ChronoballBallExecute } = await import('./ball-execute.js');

      // Resolve the match scene from the initiating player's scene id (the host may
      // be viewing a different scene). Fall back to the standard resolution.
      const scene = ChronoballUtils.getMatchScene(data.sceneId);
      if (!scene) {
        ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
        return;
      }

      // Store the active match scene ID on the Ball Actor's flags
      const ballActor = await ChronoballState.getOrCreateBallActor();
      if (ballActor) {
        await ballActor.setFlag('chronoball', 'matchActiveSceneId', scene.id);
      }

      // Create or find ball token
      await ChronoballBallExecute.ensureBallToken();

      // Rebuild turn order
      await ChronoballRoster.rebuildTurnOrder();

      // Reset match state
      await ChronoballState.resetTurnDistances();

      ui.notifications.info('Match started!');
      this.broadcastActionComplete('startMatch');
      ChronoballUtils.log(`Chronoball | Start match completed successfully`);
    } catch (e) {
      console.error('Chronoball | Failed to execute start match via GM:', e);
      ui.notifications.error('Failed to start match. Check console for details.');
    }
  }

  static async executeFinishTurn(data) {
    try {
      ChronoballUtils.log(`Chronoball | GM executing finish turn`);
      const { ChronoballState } = await import('./state.js');
      await ChronoballState.nextTurn();
      this.broadcastActionComplete('finishTurn');
      ChronoballUtils.log(`Chronoball | Finish turn completed successfully`);
    } catch (e) {
      console.error('Chronoball | Failed to execute finish turn via GM:', e);
    }
  }

  static async executeEndMatch(data) {
    const { ChronoballBallExecute } = await import('./ball-execute.js');
    await ChronoballBallExecute.executeEndMatch(data);
  }

  static async executePlayerMovedToken(data) {
    const { tokenId, changes, oldPos } = data;
    const tokenDoc = ChronoballUtils.getMatchScene()?.tokens.get(tokenId);
    if (tokenDoc) {
      const { Chronoball } = await import('../chronoball.js');
      Chronoball.handleTokenMovement(tokenDoc, changes, oldPos);
    }
  }

  static async executeDetermineTeams(data) {
    const { ChronoballRoster } = await import('./roster.js');
    await ChronoballRoster.determineTeamsFromEndzones(data.sceneId);
    this.broadcastActionComplete('determineTeams');
  }

}
