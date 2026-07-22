/**
 * ChronoballState - Manages match state and persistence
 */

import { ChronoballSocket } from './socket.js';
import { ChronoballUtils } from './utils.js';

export class ChronoballState {
  static FLAG_SCOPE = 'chronoball';
  static FLAG_MATCH_STATE = 'matchState';
  static FLAG_TEAM_ASSIGNMENT = 'teamAssignment';
  static FLAG_BALL_TOKEN = 'ballToken';
  static FLAG_CARRIER = 'isCarrier';
  
  // Queue for atomic state updates
  static _stateUpdateQueue = Promise.resolve();
  
  static initialize() {
    ChronoballUtils.log('Chronoball | State manager initialized');
  }
  
  /**
   * Get current match state
   */
  static getMatchState() {
    if (this._matchState) return this._matchState;
    const actor = this.getBallActor();
    const actorState = actor?.getFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE);
    this._matchState = actorState ? { ...this.getDefaultMatchState(), ...actorState } : this.getDefaultMatchState();
    return this._matchState;
  }
  
  /**
   * Get default match state
   */
  static getDefaultMatchState() {
    return {
      teamAName: 'Team A',
      teamBName: 'Team B',
      teamAScore: 0,
      teamBScore: 0,
      attackingTeam: 'A',
      defendingTeam: 'B',
      carrierId: null,
      ballTokenId: null,
      remainingMove: 0,
      remainingThrow: 0,
      phase: 1,
      lastScoreTimestamp: 0,
      carrierDamageInRound: 0,
      throwInProgress: false,
      turnOrder: [],
      currentTurnIndex: -1,
      round: 0
    };
  }
  
  /**
   * Update match state
   */
  static async updateState(updates) {
    return this._stateUpdateQueue = this._stateUpdateQueue.then(async () => {
      const currentState = this.getMatchState();
      const newState = { ...currentState, ...updates };
      this._matchState = newState;

      const actor = this.getBallActor();
      if (actor) {
        try {
          await actor.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, newState);
        } catch (e) {
          ChronoballUtils.log('Chronoball | Failed to write matchState on ball actor', e);
        }
      }
      // Trigger HUD update for ALL clients via socket
      ChronoballSocket.emit('stateChanged', { newState });
      Hooks.callAll('chronoball.stateChanged', newState);
      ChronoballUtils.log('Chronoball | State updated and broadcasted to all clients');
      return newState;
    });
  }
  
  /**
   * Reset match state
   */
  static async resetState() {
    const defaultState = this.getDefaultMatchState();
    const actor = this.getBallActor();
    if (actor) {
      try {
        await actor.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, defaultState);
      } catch (e) {
        ChronoballUtils.log('Chronoball | Failed to reset matchState on ball actor', e);
      }
    }
    this._matchState = defaultState;
    ChronoballSocket.emit('stateChanged', { newState: defaultState });
    Hooks.callAll('chronoball.stateChanged', defaultState);
  }
  
  /**
   * Get team assignment for an actor
   */
  static getTeamAssignment(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return null;
    
    return actor.getFlag(this.FLAG_SCOPE, this.FLAG_TEAM_ASSIGNMENT);
  }
  
  /**
   * Set team assignment for an actor
   */
  static async setTeamAssignment(actorId, team) {
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const { ChronoballSocket } = await import('./socket.js');
    if (!ChronoballSocket.isAuthorizedExecutor(actor)) {
      await ChronoballSocket.executeAsGM('setTeamAssignment', { actorId, team });
      return;
    }
    await actor.setFlag(this.FLAG_SCOPE, this.FLAG_TEAM_ASSIGNMENT, team);
  }

  /**
   * Clear team assignment for an actor
   */
  static async clearTeamAssignment(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const { ChronoballSocket } = await import('./socket.js');
    if (!ChronoballSocket.isAuthorizedExecutor(actor)) {
      await ChronoballSocket.executeAsGM('clearTeamAssignment', { actorId });
      return;
    }
    await actor.unsetFlag(this.FLAG_SCOPE, this.FLAG_TEAM_ASSIGNMENT);
  }
  
  /**
   * Get all actors assigned to a team
   */
  static getTeamRoster(team) {
    return game.actors.filter(actor => {
      const assignment = actor.getFlag(this.FLAG_SCOPE, this.FLAG_TEAM_ASSIGNMENT);
      return assignment === team;
    });
  }
  
  /**
   * Get the TokenDocument for an id from the match scene (works even when the
   * host is not viewing that scene). Use this in authoritative/host code.
   */
  static getMatchTokenDoc(tokenId) {
    return ChronoballUtils.getMatchScene()?.tokens.get(tokenId) ?? null;
  }

  /**
   * Mark token as ball token
   */
  static async setBallToken(tokenId) {
    const tokenDoc = this.getMatchTokenDoc(tokenId);
    if (!tokenDoc) return;

    await tokenDoc.setFlag(this.FLAG_SCOPE, this.FLAG_BALL_TOKEN, true);

    // Update match state
    await this.updateState({ ballTokenId: tokenId });
  }

  /**
   * Check if token is ball token
   */
  static isBallToken(tokenId) {
    const tokenDoc = this.getMatchTokenDoc(tokenId);
    if (!tokenDoc) return false;

    return tokenDoc.getFlag(this.FLAG_SCOPE, this.FLAG_BALL_TOKEN) === true;
  }

  /**
   * Get ball token (placeable) — for client/UI use on the viewed scene.
   */
  static getBallToken() {
    const state = this.getMatchState();
    if (!state.ballTokenId) return null;

    return canvas.tokens.get(state.ballTokenId);
  }

  /**
   * Get ball TokenDocument from the match scene — for authoritative/host use.
   */
  static getBallTokenDoc() {
    const state = this.getMatchState();
    if (!state.ballTokenId) return null;
    return this.getMatchTokenDoc(state.ballTokenId);
  }

  /**
   * Set carrier status on token
   */
  static async setCarrierStatus(tokenId, isCarrier) {
    const tokenDoc = this.getMatchTokenDoc(tokenId);
    if (!tokenDoc) return;

    await tokenDoc.setFlag(this.FLAG_SCOPE, this.FLAG_CARRIER, isCarrier);

    if (isCarrier) {
      await this.updateState({
        carrierId: tokenId,
        carrierDamageInRound: 0
      });
    }
  }

  /**
   * Check if token is carrier
   */
  static isCarrier(tokenId) {
    const tokenDoc = this.getMatchTokenDoc(tokenId);
    if (!tokenDoc) return false;

    return tokenDoc.getFlag(this.FLAG_SCOPE, this.FLAG_CARRIER) === true;
  }

  /**
   * Get carrier token (placeable) — for client/UI use on the viewed scene.
   */
  static getCarrierToken() {
    const state = this.getMatchState();
    if (!state.carrierId) return null;

    return canvas.tokens.get(state.carrierId);
  }

  /**
   * Get carrier TokenDocument from the match scene — for authoritative/host use.
   */
  static getCarrierTokenDoc() {
    const state = this.getMatchState();
    if (!state.carrierId) return null;
    return this.getMatchTokenDoc(state.carrierId);
  }

  /**
   * Get movement limits based on rules, including legacy mode
   */
  static getMovementLimits() {
    const rules = this.getRules();
    
    let moveLimit = rules.ballMove || 0;
    let throwLimit = rules.ballThrow || 0;
    
    // Legacy mode: if both are 0, use legacy total and split it
    if (moveLimit === 0 && throwLimit === 0) {
      const legacyTotal = rules.legacyTotal || 90;
      moveLimit = Math.ceil(legacyTotal / 2);
      throwLimit = Math.floor(legacyTotal / 2);
    }

    return { move: moveLimit, throw: throwLimit };
  }
  
  /**
   * Reset remaining distances for new turn
   */
  static async resetTurnDistances() {
    const limits = this.getMovementLimits();
    
    await this.updateState({
      remainingMove: limits.move,
      remainingThrow: limits.throw
    });
  }
  
  /**
   * Check and deduct carrier movement based on endzone location
   * Movement within own endzone is FREE
   */
  static async checkAndDeductCarrierMovement(tokenDoc, oldX, oldY, newX, newY, feetDistance) {
    const state = ChronoballState.getMatchState();
    const rules = this.getRules();
    
    // Determine own endzone based on attacking team
    const ownEndzoneId = state.attackingTeam === 'A' ? rules.zoneARegionId : rules.zoneBRegionId;

    if (!ownEndzoneId) {
      // No endzone configured, deduct movement normally
      await this.deductMoveDistance(feetDistance);
      return;
    }

    // Check if start and end positions are in own endzone (using token center)
    const wasInOwnEndzone = this.isTokenCenterInRegion(tokenDoc, oldX, oldY, ownEndzoneId);
    const isInOwnEndzone = this.isTokenCenterInRegion(tokenDoc, newX, newY, ownEndzoneId);
    
    if (wasInOwnEndzone && isInOwnEndzone) {
      // Both positions in own endzone - NO movement deducted
      ChronoballUtils.log(`Chronoball | Carrier moved ${feetDistance.toFixed(1)}ft within own endzone (FREE)`);
    } else {
      // Movement counts against limit
      await this.deductMoveDistance(feetDistance);
      ChronoballUtils.log(`Chronoball | Carrier moved ${feetDistance.toFixed(1)}ft (counted against limit)`);
    }
  }

  /**
   * Resolve an endzone Region on a scene by id (preferred) or name.
   * @returns {RegionDocument|null}
   */
  static getZoneRegion(regionId, scene = ChronoballUtils.getMatchScene()) {
    if (!regionId || !scene) return null;
    const idOnly = regionId.includes('.') ? regionId.split('.').pop() : regionId;
    return scene.regions.get(idOnly) ?? scene.regions.getName(regionId) ?? null;
  }

  /**
   * Test whether a token's center (at the given top-left x/y) lies inside an
   * endzone Region. Uses RegionDocument#testPoint, which is pure geometry over
   * the region's shapes and therefore works even when the host views another scene.
   */
  static isTokenCenterInRegion(tokenDoc, x, y, regionId, scene = ChronoballUtils.getMatchScene()) {
    const region = this.getZoneRegion(regionId, scene);
    const gridSize = scene?.grid.size;
    if (!region || !gridSize) return false;

    const centerX = x + (tokenDoc.width * gridSize) / 2;
    const centerY = y + (tokenDoc.height * gridSize) / 2;

    return region.testPoint({ x: centerX, y: centerY, elevation: tokenDoc.elevation ?? 0 });
  }
  
  /**
   * Deduct from remaining move distance
   */
  static async deductMoveDistance(distance) {
    const state = this.getMatchState();
    const newRemaining = Math.max(0, state.remainingMove - distance);
    await this.updateState({ remainingMove: newRemaining });
  }
  
  /**
   * Deduct from remaining throw distance
   */
  static async deductThrowDistance(distance) {
    const state = this.getMatchState();
    const newRemaining = Math.max(0, state.remainingThrow - distance);
    await this.updateState({ remainingThrow: newRemaining });
  }
  
  /**
   * Get rules configuration
   */
  static getRules() {
    const actor = this.getBallActor();
    const rules = actor?.getFlag(this.FLAG_SCOPE, 'rules');
    return rules ? { ...this.getDefaultRules(), ...rules } : this.getDefaultRules();
  }

  /**
   * Check if a Chronoball match is active on the currently viewed scene
   */
  static isMatchActiveOnCurrentScene() {
    if (!canvas.scene) return false;
    const actor = this.getBallActor();
    const activeSceneId = actor?.getFlag(this.FLAG_SCOPE, 'matchActiveSceneId');
    return activeSceneId === canvas.scene.id;
  }

  /**
   * Get default rules
   */
  static getDefaultRules() {
    return {
      zoneARegionId: '',
      zoneBRegionId: '',
      ballMove: 0,
      ballThrow: 0,
      legacyTotal: 90,
      baseDC: 10,
      stepDistance: 10,
      dcIncrease: 2,
      availableSkills: 'ath:Athletics,acr:Acrobatics,slt:Sleight of Hand',
      interceptRadius: 10,
      interceptTimeout: 10000,
      interceptOnThrow: true,
      blockAtReceiver: true,
      carrierTempHP: 10,
      carrierAuraSource: '',
      carrierAuraScale: 1.5,
      activePlayerAuraSource: '',
      activePlayerAuraScale: 1.5,
      allowRollModification: true,
      maxPlayers: 3,
      ballTexture: 'icons/svg/mystery-man.svg',
      ballScale: 1.0,
      scoreRunIn: 2,
      scoreThrow: 1,
      scorePassInZone: 2,
      fumbleStartDC: 10,
      fumbleDamageThreshold: 10,
      fumbleDCIncrease: 2
    };
  }
  
  /**
   * Update rules configuration
   */
  static async updateRules(updates) {
    const actor = this.getBallActor();
    if (!actor) return;

    const { ChronoballSocket } = await import('./socket.js');
    if (!ChronoballSocket.isAuthorizedExecutor(actor)) {
      await ChronoballSocket.executeAsGM('updateRules', { updates });
      return;
    }

    const currentRules = this.getRules();
    const newRules = { ...currentRules, ...updates };

    await actor.setFlag(this.FLAG_SCOPE, 'rules', newRules);

    // If maxPlayers changed, rebuild the turn order!
    if (updates.maxPlayers !== undefined && updates.maxPlayers !== currentRules.maxPlayers) {
      const { ChronoballRoster } = await import('./roster.js');
      await ChronoballRoster.rebuildTurnOrder();
    }
  }
  
  /**
   * Advance to the next turn in the custom turn order
   */
  static async nextTurn() {
    // Only primary GM/Host should update state to avoid duplicate updates
    if (!ChronoballSocket.isPrimaryGM()) {
      ChronoballUtils.log('Chronoball | Not primary GM/Host, skipping turn advance');
      return;
    }

    const state = this.getMatchState();
    if (!state.turnOrder || state.turnOrder.length === 0) return;

    const nextIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
    const isNewRound = nextIndex === 0;
    const newRound = isNewRound ? (state.round || 1) + 1 : (state.round || 1);

    ChronoballUtils.log(`Chronoball | Advancing turn to index ${nextIndex}, round ${newRound}`);

    // Reset carrier damage for the new round
    const roundUpdates = isNewRound ? { carrierDamageInRound: 0 } : {};

    await this.updateState({
      currentTurnIndex: nextIndex,
      round: newRound,
      ...roundUpdates
    });

    // Reset turn distances for the new turn
    await this.resetTurnDistances();

    ChronoballUtils.log('Chronoball | Turn advanced, distances reset (GM/Host), HUD updated for all clients');
  }
  
  /**
   * End current phase and spawn ball in new attacking zone
   */
  static async endPhase() {
    const state = this.getMatchState();
    const rules = this.getRules();

    // Validate endzones BEFORE mutating state to avoid inconsistent game state
    const newAttacking = state.attackingTeam === 'A' ? 'B' : 'A';
    const spawnZoneId = newAttacking === 'A' ? rules.zoneARegionId : rules.zoneBRegionId;
    if (!spawnZoneId) {
      ui.notifications.error('Cannot end phase: Endzone for new attacking team not configured');
      return;
    }
    if (!this.getZoneRegion(spawnZoneId)) {
      ui.notifications.error('Cannot end phase: Endzone region not found on scene');
      return;
    }

    // Clear current carrier BEFORE mutating state so we can access the token
    const { ChronoballCarrier } = await import('./carrier.js');
    await ChronoballCarrier.executeClearCarrier();

    const newDefending = state.defendingTeam === 'A' ? 'B' : 'A';
    const limits = this.getMovementLimits();
    await this.updateState({
      attackingTeam: newAttacking,
      defendingTeam: newDefending,
      phase: state.phase + 1,
      carrierId: null,
      remainingMove: limits.move,
      remainingThrow: limits.throw
    });
    
    // Delete old ball token if exists
    const oldBall = this.getBallTokenDoc();
    if (oldBall) {
      await oldBall.delete();
      await this.updateState({ ballTokenId: null });
    }
    
    // Spawn ball in NEW attacking team's zone
    await this.spawnBallInAttackingZone();
    
    // Rebuild turn order after every phase change — attacking team gets first turn
    const ChronoballRoster = (await import('./roster.js')).ChronoballRoster;
    await ChronoballRoster.rebuildTurnOrder();
    
    ChronoballUtils.log('Chronoball | Phase ended, teams switched, ball spawned in new attacking zone');
  }
  
  /**
   * Spawn ball in the attacking team's zone (their own endzone/start zone)
   */
  static async spawnBallInAttackingZone() {
    const state = this.getMatchState();
    const rules = this.getRules();
    
    // Determine which zone to spawn ball in based on attacking team
    const spawnZoneId = state.attackingTeam === 'A' ? rules.zoneARegionId : rules.zoneBRegionId;

    if (!spawnZoneId) {
      ui.notifications.error('Cannot spawn ball: Endzone not configured');
      return;
    }

    // Resolve the endzone Region and use its bounds center
    const matchScene = ChronoballUtils.getMatchScene();
    const zoneRegion = this.getZoneRegion(spawnZoneId, matchScene);

    if (!zoneRegion) {
      ui.notifications.error('Cannot spawn ball: Endzone region not found');
      return;
    }

    // Calculate center of zone from the region bounds
    const bounds = zoneRegion.bounds;
    const centerX = bounds.x + (bounds.width / 2);
    const centerY = bounds.y + (bounds.height / 2);

    // Adjust for token size
    const gridSize = matchScene.grid.size;
    const tokenX = centerX - (gridSize / 2);
    const tokenY = centerY - (gridSize / 2);
    
    // Find or create ball actor robustly
    const ballActor = await this.getOrCreateBallActor();
    
    if (!ballActor) {
      ui.notifications.error('Could not find or create the ball actor');
      return;
    }
    
    // Create ball token
    const tokenData = ChronoballUtils.applyTokenHudDefaults({
      name: 'Chronoball',
      actorId: ballActor.id,
      x: tokenX,
      y: tokenY,
      texture: {
        src: rules.ballTexture || 'icons/svg/item-bag.svg'
      },
      width: 1,
      height: 1,
      scale: rules.ballScale || 1.0,
      lockRotation: true
    });
    
    const [createdToken] = await matchScene.createEmbeddedDocuments('Token', [tokenData]);

    if (createdToken) {
      await this.setBallToken(createdToken.id);
      const teamName = state.attackingTeam === 'A' ? state.teamAName : state.teamBName;
      ChronoballUtils.log(`Chronoball | Ball spawned in Zone ${state.attackingTeam} for ${teamName}`);
    }
  }
  
  // ensureCombat removed (bypassed combat tracker)

  static getBallActor() {
    let actorId = '';
    try {
      actorId = game.settings.get('chronoball', 'ballActorId');
    } catch (e) {
      actorId = '';
    }

    let ballActor = actorId ? game.actors.get(actorId) : null;
    if (ballActor) return ballActor;

    ballActor = game.actors.find(a => a.name === 'Chronoball');
    return ballActor || null;
  }

  /**
   * Get or create the Chronoball actor
   */
  static async getOrCreateBallActor() {
    let ballActor = this.getBallActor();
    if (ballActor) return ballActor;

    // If not found, create it
    try {
      ballActor = await Actor.create({
        name: 'Chronoball',
        type: 'character',
        img: 'icons/svg/item-bag.svg'
      });
      if (ballActor) {
        try {
          if (game.user.isGM) {
            await game.settings.set('chronoball', 'ballActorId', ballActor.id);
          }
        } catch (e) {}
        return ballActor;
      }
    } catch (e) {
      console.error('Chronoball | Failed to create Chronoball actor:', e);
    }
    return null;
  }

}
