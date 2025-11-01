/**
 * ChronoballSocket - Handles socket communication for authoritative actions
 */

import { ChronoballUtils } from './utils.js';

export class ChronoballSocket {
  static SOCKET_NAME = 'module.chronoball';
  
  static initialize() {
    game.socket.on(this.SOCKET_NAME, this.onSocketMessage.bind(this));
    ChronoballUtils.log('Chronoball | Socket initialized');
  }

  /**
   * Handle incoming socket messages
   */
  static async onSocketMessage(data) {
    ChronoballUtils.log('Chronoball | Socket message received:', data);
    const { action, targetUserId } = data;

    // Route player-targeted messages
    if (targetUserId && targetUserId === game.user.id) {
      const ChronoballFumble = (await import('./fumble.js')).ChronoballFumble;
      const ChronoballInterception = (await import('./interception.js')).ChronoballInterception;
      switch (action) {
        case 'requestFumbleSave':
          return ChronoballFumble.handleFumbleSaveRequest(data);
        case 'interceptionRequest':
          return ChronoballInterception.showInterceptionDialog(data.data);
        case 'requestSaveType':
          return ChronoballInterception.handleSaveTypeRequest(data.data);
        case 'requestSaveRoll':
          return ChronoballInterception.handleSaveRollRequest(data.data);
      }
    }

    // Route GM-only messages
    if (this.isPrimaryGM()) {
      const ChronoballFumble = (await import('./fumble.js')).ChronoballFumble;
      const ChronoballInterception = (await import('./interception.js')).ChronoballInterception;
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
        
        // Responses to GM
        case 'fumbleSaveResponse':
          return ChronoballFumble.handleFumbleSaveResponse(data);
        case 'interceptionResponse':
          return ChronoballInterception.handleInterceptionResponse(data.data.requestId, data.data.accepted);
        case 'saveTypeResponse':
          return ChronoballInterception.handleSaveTypeResponse(data.data);
        case 'saveRollResponse':
          return ChronoballInterception.handleSaveRollResponse(data.data);
        
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
    if (this.isPrimaryGM()) {
      // Execute directly
      return await this.onSocketMessage({ action, ...data });
    } else {
      // Send to GM via socket
      this.emit(action, data);
      // Return a promise that resolves when we get confirmation
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
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
  
  /**
   * Check if current user is primary GM
   */
  static isPrimaryGM() {
    if (!game.user.isGM) return false;
    
    const primaryGMId = game.settings.get('chronoball', 'primaryGM');
    
    // If no primary GM set, use first active GM
    if (!primaryGMId) {
      const activeGMs = game.users.filter(u => u.isGM && u.active);
      return activeGMs[0]?.id === game.user.id;
    }
    
    return game.user.id === primaryGMId;
  }
  
  /**
   * Get primary GM user
   */
  static getPrimaryGM() {
    const primaryGMId = game.settings.get('chronoball', 'primaryGM');
    
    if (primaryGMId) {
      const user = game.users.get(primaryGMId);
      if (user && user.isGM && user.active) return user;
    }
    
    // Fallback to first active GM
    return game.users.find(u => u.isGM && u.active);
  }
  
  // Execution methods for authoritative actions
  
  static async executeThrowBall(data) {
    const { tokenId, targetX, targetY, skill, distance, dc, rollTotal, success } = data;
    // Implementation delegated to ChronoballBall
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeThrow(tokenId, targetX, targetY, skill, distance, dc, rollTotal, success);
    Hooks.callAll('chronoball.actionComplete', 'throwBall');
  }
  
  static async executePassBall(data) {
    const { tokenId, targetTokenId, skill, distance, dc, rollTotal, success } = data;
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executePass(tokenId, targetTokenId, skill, distance, dc, rollTotal, success);
    Hooks.callAll('chronoball.actionComplete', 'passBall');
  }
  
  static async executePickupBall(data) {
    const { tokenId } = data;
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executePickup(tokenId);
    Hooks.callAll('chronoball.actionComplete', 'pickupBall');
  }
  
  static async executeDropBall(data) {
    const { tokenId, dropX, dropY } = data;
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeDrop(tokenId, dropX, dropY);
    Hooks.callAll('chronoball.actionComplete', 'dropBall');
  }
  
  static async executeSetCarrier(data) {
    const { tokenId } = data;
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeSetCarrier(tokenId);
    Hooks.callAll('chronoball.actionComplete', 'setCarrier');
  }
  
  static async executeClearCarrier(data) {
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeClearCarrier();
    Hooks.callAll('chronoball.actionComplete', 'clearCarrier');
  }
  
  static async executeUpdateMatchState(data) {
    const { updates } = data;
    const ChronoballState = (await import('./state.js')).ChronoballState;
    await ChronoballState.updateState(updates);
    Hooks.callAll('chronoball.actionComplete', 'updateMatchState');
  }
  
  static async executeInterceptionResponse(data) {
    const { defenderId, accepted, type } = data;
    const ChronoballInterception = (await import('./interception.js')).ChronoballInterception;
    await ChronoballInterception.handleResponse(defenderId, accepted, type);
    Hooks.callAll('chronoball.actionComplete', 'interceptionResponse');
  }

  static async executeFumbleBall(data) {
    const { tokenId } = data;
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeFumble(tokenId);
    Hooks.callAll('chronoball.actionComplete', 'fumbleBall');
  }

  static async executeSetTeamAssignment(data) {
    const { actorId, team } = data;
    try {
      const { ChronoballState } = await import('./state.js');
      await ChronoballState.setTeamAssignment(actorId, team);
    } catch (e) {
      console.error('Chronoball | Failed to set team assignment via GM:', e);
    }
  }

  static async executeClearTeamAssignment(data) {
    const { actorId } = data;
    try {
      const { ChronoballState } = await import('./state.js');
      await ChronoballState.clearTeamAssignment(actorId);
    } catch (e) {
      console.error('Chronoball | Failed to clear team assignment via GM:', e);
    }
  }

}
