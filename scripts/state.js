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
  
  static initialize() {
    ChronoballUtils.log('Chronoball | State manager initialized');
  }
  
  /**
   * Get current match state
   */
  static getMatchState() {
    const combat = game.combat;
    if (!combat) {
      const scene = canvas.scene;
      if (!scene) return this.getDefaultMatchState();
      const sceneState = scene.getFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE);
      return sceneState || this.getDefaultMatchState();
    }
    const state = combat.getFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE);
    return state || this.getDefaultMatchState();
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
      hudVisible: false,
      phase: 1,
      lastScoreTimestamp: 0,
      attackedA: false,
      attackedB: false,
      carrierDamageInRound: 0,
      throwInProgress: false
    };
  }
  
  /**
   * Update match state
   */
  static async updateState(updates) {
    const combat = game.combat;
    const currentState = this.getMatchState();
    const newState = { ...currentState, ...updates };
    if (!combat) {
      const scene = canvas.scene;
      if (!scene) {
        console.warn('Chronoball | No scene found, cannot update state');
        return;
      }
      await scene.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, newState);
    } else {
      await combat.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, newState);
    }
    // Trigger HUD update for ALL clients via hook
    Hooks.callAll('chronoball.stateChanged', newState);
    ChronoballUtils.log('Chronoball | State updated and broadcasted to all clients');
    return newState;
  }
  
  /**
   * Reset match state
   */
  static async resetState() {
    const defaultState = this.getDefaultMatchState();
    const combat = game.combat;
    if (combat) {
      await combat.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, defaultState);
    } else if (canvas.scene) {
      await canvas.scene.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, defaultState);
    }
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
  if (!game.user.isGM) {
    const { ChronoballSocket } = await import('./socket.js');
    await ChronoballSocket.executeAsGM('setTeamAssignment', { actorId, team });
    return;
  }
  const actor = game.actors.get(actorId);
  if (!actor) return;
  await actor.setFlag(this.FLAG_SCOPE, this.FLAG_TEAM_ASSIGNMENT, team);
}
  
  /**
   * Clear team assignment for an actor
   */
  static async clearTeamAssignment(actorId) {
  if (!game.user.isGM) {
    const { ChronoballSocket } = await import('./socket.js');
    await ChronoballSocket.executeAsGM('clearTeamAssignment', { actorId });
    return;
  }
  const actor = game.actors.get(actorId);
  if (!actor) return;
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
   * Mark token as ball token
   */
  static async setBallToken(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token) return;
    
    await token.document.setFlag(this.FLAG_SCOPE, this.FLAG_BALL_TOKEN, true);
    
    // Update match state
    await this.updateState({ ballTokenId: tokenId });
  }
  
  /**
   * Check if token is ball token
   */
  static isBallToken(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token) return false;
    
    return token.document.getFlag(this.FLAG_SCOPE, this.FLAG_BALL_TOKEN) === true;
  }
  
  /**
   * Get ball token
   */
  static getBallToken() {
    const state = this.getMatchState();
    if (!state.ballTokenId) return null;
    
    return canvas.tokens.get(state.ballTokenId);
  }
  
  /**
   * Set carrier status on token
   */
  static async setCarrierStatus(tokenId, isCarrier) {
    const token = canvas.tokens.get(tokenId);
    if (!token) return;
    
    await token.document.setFlag(this.FLAG_SCOPE, this.FLAG_CARRIER, isCarrier);
    
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
    const token = canvas.tokens.get(tokenId);
    if (!token) return false;
    
    return token.document.getFlag(this.FLAG_SCOPE, this.FLAG_CARRIER) === true;
  }
  
  /**
   * Get carrier token
   */
  static getCarrierToken() {
    const state = this.getMatchState();
    if (!state.carrierId) return null;
    
    return canvas.tokens.get(state.carrierId);
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
    // Only GM should update state
    if (!game.user.isGM) {
      return;
    }
    
    const state = this.getMatchState();
    const rules = this.getRules();
    
    // Determine own endzone based on attacking team
    const ownEndzoneId = state.attackingTeam === 'A' ? rules.zoneATileId : rules.zoneBTileId;
    
    if (!ownEndzoneId) {
      // No endzone configured, deduct movement normally
      await this.deductMoveDistance(feetDistance);
      return;
    }
    
    // Check if start and end positions are in own endzone (using token center)
    const wasInOwnEndzone = this.isTokenCenterInTile(tokenDoc, oldX, oldY, ownEndzoneId);
    const isInOwnEndzone = this.isTokenCenterInTile(tokenDoc, newX, newY, ownEndzoneId);
    
    if (wasInOwnEndzone && isInOwnEndzone) {
      // Both positions in own endzone - NO movement deducted
      ChronoballUtils.log(`Chronoball | Carrier moved ${feetDistance.toFixed(1)}ft within own endzone (FREE)`);
    } else {
      // Movement counts against limit
      await this.deductMoveDistance(feetDistance);
      ChronoballUtils.log(`Chronoball | Carrier moved ${feetDistance.toFixed(1)}ft (counted against limit)`);
    }
  }

  static isTokenCenterInTile(tokenDoc, x, y, tileId) {
    if (!tileId) return false;

    const tileIdOnly = tileId.includes('.') ? tileId.split('.').pop() : tileId;
    const tile = canvas.tiles.get(tileIdOnly);
    
    // Use the scene's grid size for safety, canvas global might be unreliable.
    const gridSize = canvas.scene.grid.size;
    if (!tile || !gridSize) return false;

    const tokenWidthInPixels = tokenDoc.width * gridSize;
    const tokenHeightInPixels = tokenDoc.height * gridSize;
    const centerX = x + tokenWidthInPixels / 2;
    const centerY = y + tokenHeightInPixels / 2;

    const tileBounds = tile.bounds;
    
    return (
      centerX >= tileBounds.x &&
      centerX <= tileBounds.x + tileBounds.width &&
      centerY >= tileBounds.y &&
      centerY <= tileBounds.y + tileBounds.height
    );
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
    const scene = canvas.scene;
    if (!scene) return this.getDefaultRules();
    
    const rules = scene.getFlag(this.FLAG_SCOPE, 'rules');
    return rules || this.getDefaultRules();
  }
  
  /**
   * Get default rules
   */
  static getDefaultRules() {
    return {
      zoneATileId: '',
      zoneBTileId: '',
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
      ballTexture: 'icons/svg/mystery-man.svg',
      ballScale: 1.0,
      scoreRunIn: 2,
      scoreThrow: 1,
      scorePassInZone: 2,
      fumbleStartDC: 10,
      fumbleDamageThreshold: 10,
      fumbleDCIncrease: 2 // New setting for configurable fumble DC increase
    };
  }
  
  /**
   * Update rules configuration
   */
  static async updateRules(updates) {
    const scene = canvas.scene;
    if (!scene) return;
    
    const currentRules = this.getRules();
    const newRules = { ...currentRules, ...updates };
    
    await scene.setFlag(this.FLAG_SCOPE, 'rules', newRules);
  }
  
  /**
   * Handle combat turn change
   */
  static async onCombatTurnChange(combat) {
    // Only GM should update state
    if (!game.user.isGM) {
      ChronoballUtils.log('Chronoball | Non-GM user, skipping state update but rendering HUD');
      // Non-GMs just update their HUD based on the current state
      Hooks.callAll('chronoball.stateChanged', this.getMatchState());
      return;
    }
    
    // GM resets turn distances for new turn
    await this.resetTurnDistances();
    
    // Trigger state change hook to update HUD for all clients
    Hooks.callAll('chronoball.stateChanged', this.getMatchState());
    
    ChronoballUtils.log('Chronoball | Turn changed, distances reset (GM), HUD updated for all clients');
  }
  
  /**
   * End current phase and spawn ball in new attacking zone
   */
  static async endPhase() {
    const state = this.getMatchState();
    const rules = this.getRules();
    
    // Clear current carrier BEFORE mutating state so we can access the token
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    const currentCarrier = this.getCarrierToken();
    if (currentCarrier) {
      await ChronoballBall.executeClearCarrier();
    }
    
    // Mark the team that just finished attacking
    const prevAttacking = state.attackingTeam; // 'A' or 'B'
    const attackedA = state.attackedA || false;
    const attackedB = state.attackedB || false;
    const updatedFlags = {
      attackedA: prevAttacking === 'A' ? true : attackedA,
      attackedB: prevAttacking === 'B' ? true : attackedB
    };
    
    // Switch attacking/defending teams
    const newAttacking = state.attackingTeam === 'A' ? 'B' : 'A';
    const newDefending = state.defendingTeam === 'A' ? 'B' : 'A';
    
    await this.updateState({
      ...updatedFlags,
      attackingTeam: newAttacking,
      defendingTeam: newDefending,
      phase: state.phase + 1,
      carrierId: null
    });
    
    // Delete old ball token if exists
    const oldBall = this.getBallToken();
    if (oldBall) {
      await oldBall.document.delete();
      await this.updateState({ ballTokenId: null });
    }
    
    // Spawn ball in NEW attacking team's zone
    await this.spawnBallInAttackingZone();
    
    // Reroll initiative only after BOTH teams have attacked once
    const postState = this.getMatchState();
    if (postState.attackedA && postState.attackedB) {
      const ChronoballRoster = (await import('./roster.js')).ChronoballRoster;
      await ChronoballRoster.rebuildInitiative(false);
      // Reset flags for the next cycle
      await this.updateState({ attackedA: false, attackedB: false });
      ChronoballUtils.log('Chronoball | Both teams have attacked since last reroll — initiative rebuilt');
    }
    
    ChronoballUtils.log('Chronoball | Phase ended, teams switched, ball spawned in new attacking zone');
  }
  
  /**
   * Spawn ball in the attacking team's zone (their own endzone/start zone)
   */
  static async spawnBallInAttackingZone() {
    const state = this.getMatchState();
    const rules = this.getRules();
    
    // Determine which zone to spawn ball in based on attacking team
    const spawnZoneId = state.attackingTeam === 'A' ? rules.zoneATileId : rules.zoneBTileId;
    
    if (!spawnZoneId) {
      ui.notifications.error('Cannot spawn ball: Endzone not configured');
      return;
    }
    
    // Extract Tile ID from UUID
    const zoneIdOnly = spawnZoneId.split('.').pop();
    const zoneTile = canvas.tiles.get(zoneIdOnly);
    
    if (!zoneTile) {
      ui.notifications.error('Cannot spawn ball: Zone tile not found');
      return;
    }
    
    // Calculate center of zone
    const bounds = zoneTile.bounds;
    const centerX = bounds.x + (bounds.width / 2);
    const centerY = bounds.y + (bounds.height / 2);
    
    // Adjust for token size
    const gridSize = canvas.grid.size;
    const tokenX = centerX - (gridSize / 2);
    const tokenY = centerY - (gridSize / 2);
    
    // Create ball actor if needed
    let ballActor = game.actors.find(a => a.name === 'Chronoball');
    if (!ballActor) {
      ballActor = await Actor.create({
        name: 'Chronoball',
        type: 'character',
        img: 'icons/svg/item-bag.svg'
      });
    }
    
    if (!ballActor) {
      ui.notifications.error('Could not create ball actor');
      return;
    }
    
    // Create ball token
    const tokenData = {
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
      disposition: 0,
      lockRotation: true,
      displayName: 0,
      displayBars: 0
    };
    
    const [createdToken] = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    
    if (createdToken) {
      await this.setBallToken(createdToken.id);
      const teamName = state.attackingTeam === 'A' ? state.teamAName : state.teamBName;
      ChronoballUtils.log(`Chronoball | Ball spawned in Zone ${state.attackingTeam} for ${teamName}`);
    }
  }
  
  /**
   * Ensure combat exists for current scene
   */
  static async ensureCombat() {
    if (game.combat && game.combat.scene.id === canvas.scene.id) {
      return game.combat;
    }
    
    // Capture existing state (from scene or defaults) BEFORE creating combat,
    // so we can migrate names/scores/etc. and avoid resetting to Team A/B.
    const prevState = this.getMatchState();
    
    // Create new combat
    const combat = await Combat.create({
      scene: canvas.scene.id,
      active: true
    });
    
    await combat.activate();
    
    // Migrate previous state into the new combat flags
    try {
      await combat.setFlag(this.FLAG_SCOPE, this.FLAG_MATCH_STATE, prevState);
      Hooks.callAll('chronoball.stateChanged', prevState);
      ChronoballUtils.log('Chronoball | Migrated scene match state into new combat');
    } catch (e) {
      console.error('Chronoball | Failed to migrate match state into combat', e);
    }
    
    return combat;
  }

  /**
   * Find or create the actor used for the Chronoball token.
   * @returns {Actor|null}
   */
  static async getOrCreateBallActor() {
    const settingKey = 'ballActorId';
    let actorId = game.settings.get(this.FLAG_SCOPE, settingKey);
    let ballActor = game.actors.get(actorId);

    // 1. Try to find actor from setting
    if (ballActor) {
      return ballActor;
    }

    // 2. Try to find actor by name
    ballActor = game.actors.find(a => a.name === 'Chronoball');
    if (ballActor) {
      await game.settings.set(this.FLAG_SCOPE, settingKey, ballActor.id);
      return ballActor;
    }

    // 3. If not found, create it
    try {
      ballActor = await Actor.create({
        name: 'Chronoball',
        type: 'character', // Assuming a 'character' type actor
        img: 'icons/svg/item-bag.svg'
      });
      if (ballActor) {
        await game.settings.set(this.FLAG_SCOPE, settingKey, ballActor.id);
        return ballActor;
      }
    } catch (e) {
      console.error("Chronoball | Failed to create ball actor", e);
      ui.notifications.error("Failed to create the Chronoball actor.");
      return null;
    }
    
    return null;
  }

}