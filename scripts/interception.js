/**
 * ChronoballInterception - Handles interception and blocking mechanics
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils } from './utils.js';
import { ChronoballBall } from './ball.js';

export class ChronoballInterception {
  static pendingInterceptions = new Map();
  static socketInitialized = false;
  
  static initialize() {
    ChronoballUtils.log('Chronoball | Interception system initialized');
  }
  
  /**
   * Check for possible interceptions at thrower
   * Returns true if intercepted, false if throw can continue
   */
  static async checkInterceptionAtThrower(thrower) {
    const rules = ChronoballState.getRules();
    
    if (!rules.interceptOnThrow) return false;
    
    const defenders = this.findDefendersNearToken(thrower, rules.interceptRadius);
    
    if (defenders.length === 0) return false;
    
    ChronoballUtils.log(`Chronoball | ${defenders.length} defender(s) in range at thrower`);
    
    // Ask each defender if they want to intercept
    for (const defender of defenders) {
      const ownerUser = this.getTokenOwner(defender);
      if (!ownerUser) {
        ChronoballUtils.log(`Chronoball | No owner found for ${defender.name}`);
        continue;
      }
      
      ChronoballUtils.log(`Chronoball | Asking ${ownerUser.name} (owner of ${defender.name}) for interception decision`);
      
      const accepted = await this.askInterceptionDecisionForOwner(defender, ownerUser, rules.interceptTimeout, 'at thrower');
      
      if (accepted) {
        // Interceptor attempts, thrower must make save
        const intercepted = await this.resolveInterceptionAtThrower(thrower, defender);
        
        if (intercepted) {
          return true; // Interception successful, stop throw
        }
        // If save succeeded, continue checking other defenders
      }
    }
    
    return false; // No successful interception
  }
  
  /**
   * Check for possible interceptions at receiver (only for passes)
   * Returns true if intercepted, false if receiver gets ball
   */
  static async checkInterceptionAtReceiver(receiver, thrower) {
    const rules = ChronoballState.getRules();
    
    if (!rules.blockAtReceiver) return false;
    
    const defenders = this.findDefendersNearToken(receiver, rules.interceptRadius);
    
    if (defenders.length === 0) return false;
    
    ChronoballUtils.log(`Chronoball | ${defenders.length} defender(s) in range at receiver`);
    
    // Ask each defender if they want to intercept
    for (const defender of defenders) {
      const ownerUser = this.getTokenOwner(defender);
      if (!ownerUser) {
        ChronoballUtils.log(`Chronoball | No owner found for ${defender.name}`);
        continue;
      }
      
      ChronoballUtils.log(`Chronoball | Asking ${ownerUser.name} (owner of ${defender.name}) for interception decision at receiver`);
      
      const accepted = await this.askInterceptionDecisionForOwner(defender, ownerUser, rules.interceptTimeout, 'at receiver');
      
      if (accepted) {
        ChronoballUtils.log(`Chronoball | ${defender.name} accepted interception at receiver`);
        // Interceptor attempts, RECEIVER must make save (not thrower!)
        const intercepted = await this.resolveInterceptionAtReceiver(receiver, defender, thrower);
        
        if (intercepted) {
          return true; // Interception successful, receiver doesn't get ball
        }
        // If save succeeded, continue checking other defenders
      }
    }
    
    return false; // No successful interception
  }
  
  /**
   * Find defenders near a token
   */
  static findDefendersNearToken(token, radius) {
    const state = ChronoballState.getMatchState();
    const defendingTeam = state.defendingTeam;
    
    const defenders = [];
    
    for (const potentialDefender of canvas.tokens.placeables) {
      if (potentialDefender.id === token.id) continue;
      
      // Check if token is on defending team
      const actorTeam = ChronoballState.getTeamAssignment(potentialDefender.actor.id);
      if (actorTeam !== defendingTeam) continue;
      
      // Check if within radius
      const distance = ChronoballUtils.calculateDistance(token, potentialDefender);
      
      if (distance <= radius) {
        defenders.push(potentialDefender);
      }
    }
    
    return defenders;
  }
  
  /**
   * Get the owner/controller of a token
   */
  static getTokenOwner(token) {
    // Find a user who owns this token
    const owners = Object.entries(token.actor.ownership)
      .filter(([userId, level]) => level === 3) // OWNER level
      .map(([userId]) => game.users.get(userId))
      .filter(user => user && user.active);
    
    if (owners.length > 0) {
      ChronoballUtils.log(`Chronoball | Token ${token.name} owned by: ${owners.map(u => u.name).join(', ')}`);
    }
    
    return owners[0] || null;
  }
  
  /**
   * Calculate interception DC based on interceptor's stats
   * DC = 8 + higher of (STR or DEX) modifier + Proficiency Bonus
   */
  static calculateInterceptionDC(interceptor) {
    const actor = interceptor.actor;
    
    // Get STR and DEX modifiers
    const strMod = actor.system.abilities?.str?.mod || 0;
    const dexMod = actor.system.abilities?.dex?.mod || 0;
    
    // Use higher modifier
    const abilityMod = Math.max(strMod, dexMod);
    
    // Get proficiency bonus
    const profBonus = actor.system.attributes?.prof || 0;
    
    // Calculate DC: 8 + ability mod + proficiency
    const dc = 8 + abilityMod + profBonus;
    
    ChronoballUtils.log(`Chronoball | Interception DC for ${interceptor.name}: 8 + ${abilityMod} (ability) + ${profBonus} (prof) = ${dc}`);
    
    return dc;
  }
  
  /**
   * Resolve interception at thrower
   */
  static async resolveInterceptionAtThrower(thrower, interceptor) {
    // Calculate DC automatically from interceptor's stats
    const dc = this.calculateInterceptionDC(interceptor);
    
    ui.notifications.info(`${interceptor.name} attempts interception! DC: ${dc}`);
    
    // Thrower chooses STR or DEX save
    const saveType = await this.askForSaveType(thrower, dc, 'thrower');
    if (saveType === null) return false; // Cancelled
    
    // Thrower rolls save
    const saveResult = await this.performSaveWithModification(thrower, saveType, dc);
    if (saveResult === null) return false; // Cancelled
    
    // Create chat message
    await this.createInterceptionChatMessage(thrower, interceptor, dc, saveResult.roll.total, saveResult.success, 'thrower');
    
    if (!saveResult.success) {
      // Interception successful - TURNOVER!
      const state = ChronoballState.getMatchState();
      
      // Get interceptor's team
      const interceptorTeam = ChronoballState.getTeamAssignment(interceptor.actor.id);
      const teamName = interceptorTeam === 'A' ? state.teamAName : state.teamBName;
      
      // Create turnover chat message
      await ChronoballBall.createTurnoverChatMessage(interceptor, teamName, 'interception');
      
      // End phase immediately (ball will spawn in new attacking zone)
      await ChronoballState.endPhase();
      
      ui.notifications.info(`${interceptor.name} intercepted the ball at thrower! Turnover!`);
      return true;
    } else {
      // Save successful - throw continues
      ui.notifications.info(`${thrower.name} evaded the interception attempt!`);
      return false;
    }
  }
  
  /**
   * Resolve interception at receiver
   */
  static async resolveInterceptionAtReceiver(receiver, interceptor, thrower) {
    // Calculate DC automatically from interceptor's stats
    const dc = this.calculateInterceptionDC(interceptor);
    
    ui.notifications.info(`${interceptor.name} attempts interception at receiver! DC: ${dc}`);
    
    ChronoballUtils.log(`Chronoball | ====== INTERCEPTION AT RECEIVER ======`);
    ChronoballUtils.log(`Chronoball | Receiver Token: ${receiver.name} (id: ${receiver.id})`);
    ChronoballUtils.log(`Chronoball | Receiver Actor: ${receiver.actor.name} (id: ${receiver.actor.id})`);
    ChronoballUtils.log(`Chronoball | Interceptor: ${interceptor.name}`);
    
    // Get the receiver token owner
    const receiverOwner = this.getTokenOwner(receiver);
    ChronoballUtils.log(`Chronoball | Receiver owner: ${receiverOwner?.name || 'NONE'} (id: ${receiverOwner?.id || 'NONE'})`);
    ChronoballUtils.log(`Chronoball | Current user: ${game.user.name} (id: ${game.user.id})`);
    ChronoballUtils.log(`Chronoball | Is GM: ${game.user.isGM}`);
    
    // RECEIVER (not thrower!) chooses STR or DEX save
    ChronoballUtils.log(`Chronoball | Step 1: Asking for save type...`);
    const saveType = await this.askForSaveType(receiver, dc, 'receiver');
    if (saveType === null) {
      ChronoballUtils.log('Chronoball | Save type selection cancelled at receiver');
      return false; // Cancelled
    }
    
    ChronoballUtils.log(`Chronoball | ✓ Step 1 complete: Receiver ${receiver.name} chose ${saveType.toUpperCase()} save`);
    ChronoballUtils.log(`Chronoball | Step 2: Calling performSaveWithModification (NOT performSave!)...`);
    
    // RECEIVER rolls save with modification options
    const saveResult = await this.performSaveWithModification(receiver, saveType, dc);
    
    if (saveResult === null) {
      ChronoballUtils.log('Chronoball | ⚠ Save roll cancelled or failed at receiver');
      return false; // Cancelled
    }
    
    ChronoballUtils.log(`Chronoball | ✓ Step 2 complete: Save result for RECEIVER ${receiver.name}: ${saveResult.roll.total} vs DC ${dc} = ${saveResult.success ? 'SUCCESS' : 'FAILURE'}`);
    ChronoballUtils.log(`Chronoball | ====== END INTERCEPTION AT RECEIVER ======`);
    
    // Create chat message
    await this.createInterceptionChatMessage(receiver, interceptor, dc, saveResult.roll.total, saveResult.success, 'receiver');
    
    if (!saveResult.success) {
      // Interception successful - TURNOVER!
      const state = ChronoballState.getMatchState();
      
      // Get interceptor's team
      const interceptorTeam = ChronoballState.getTeamAssignment(interceptor.actor.id);
      const teamName = interceptorTeam === 'A' ? state.teamAName : state.teamBName;
      
      // Create turnover chat message
      await ChronoballBall.createTurnoverChatMessage(interceptor, teamName, 'interception');
      
      // End phase immediately (ball will spawn in new attacking zone)
      await ChronoballState.endPhase();
      
      ui.notifications.info(`${interceptor.name} intercepted the ball at receiver! Turnover!`);
      return true;
    } else {
      // Save successful - receiver gets ball normally
      ui.notifications.info(`${receiver.name} secured the catch!`);
      return false;
    }
  }
  
  /**
   * Ask defender if they want to intercept - sends to correct owner
   */
  static async askInterceptionDecisionForOwner(defender, ownerUser, timeout, location) {
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID();
      
      // Store the promise resolver
      this.pendingInterceptions.set(requestId, { resolve, timeout: Date.now() + timeout });
      
      // Create the dialog data
      const dialogData = {
        requestId,
        defenderName: defender.name,
        defenderId: defender.id,
        location,
        timeout
      };
      
      // If current user is the owner, show dialog directly
      if (game.user.id === ownerUser.id) {
        this.showInterceptionDialog(dialogData);
      } else {
        // Send request to owner via socket (works from ANY user, not only GM)
        game.socket.emit('module.chronoball', {
          action: 'interceptionRequest',
          data: dialogData,
          targetUserId: ownerUser.id
        });
      }
      
      // Set timeout to auto-decline
      setTimeout(() => {
        if (this.pendingInterceptions.has(requestId)) {
          this.pendingInterceptions.delete(requestId);
          ChronoballUtils.log(`Chronoball | Interception request ${requestId} timed out`);
          resolve(false);
        }
      }, timeout);
    });
  }
  
  /**
   * Show interception dialog to user
   */
  static showInterceptionDialog(dialogData) {
    const { requestId, defenderName, location, timeout } = dialogData;
    
    const dialog = new Dialog({
      title: `Interception Attempt - ${location}`,
      content: `
        <p><strong>${defenderName}</strong>, do you want to attempt an interception?</p>
        <p style="color: #f00; font-weight: bold;">Time remaining: <span id="timer-${requestId}">${timeout / 1000}s</span></p>
      `,
      buttons: {
        yes: {
          label: 'Yes, Intercept!',
          callback: () => {
            this.sendInterceptionResponse(requestId, true);
          }
        },
        no: {
          label: 'No',
          callback: () => {
            this.sendInterceptionResponse(requestId, false);
          }
        }
      },
      default: 'no',
      close: () => {
        this.sendInterceptionResponse(requestId, false);
      }
    });
    
    dialog.render(true);
    
    // Countdown timer
    let timeLeft = timeout;
    const interval = setInterval(() => {
      timeLeft -= 1000;
      const timerEl = dialog.element?.find(`#timer-${requestId}`);
      if (timerEl && timerEl.length > 0) {
        timerEl.text(`${timeLeft / 1000}s`);
      }
      
      if (timeLeft <= 0) {
        clearInterval(interval);
        dialog.close();
      }
    }, 1000);
  }
  
  /**
   * Send interception response back
   */
  static sendInterceptionResponse(requestId, accepted) {
    // If we have a local resolver, use it
    if (this.pendingInterceptions.has(requestId)) {
      const { resolve } = this.pendingInterceptions.get(requestId);
      this.pendingInterceptions.delete(requestId);
      resolve(accepted);
    } else {
      // Send via socket to GM
      game.socket.emit('module.chronoball', {
        action: 'interceptionResponse',
        data: {
          requestId,
          accepted
        }
      });
    }
  }
  
  /**
   * Handle interception response from socket
   */
  static handleInterceptionResponse(requestId, accepted) {
    if (this.pendingInterceptions.has(requestId)) {
      const { resolve } = this.pendingInterceptions.get(requestId);
      this.pendingInterceptions.delete(requestId);
      resolve(accepted);
    }
  }
  
  /**
   * Ask for save type (STR or DEX) - with proper socket handling
   */
  static async askForSaveType(token, dc, role) {
    const ownerUser = this.getTokenOwner(token);
    
    if (!ownerUser) {
      console.warn(`Chronoball | No owner found for ${token.name}, defaulting to DEX`);
      return 'dex';
    }
    
    ChronoballUtils.log(`Chronoball | Asking save type from ${ownerUser.name} for token ${token.name}`);
    
    // If current user is the owner, show dialog directly
    if (game.user.id === ownerUser.id) {
      ChronoballUtils.log(`Chronoball | Current user IS the owner, showing dialog directly`);
      return await this.showSaveTypeDialog(token.name, dc, role);
    }
    
    // If current user is GM, send request to owner via socket
    if (game.user.isGM) {
      ChronoballUtils.log(`Chronoball | GM sending save type request to ${ownerUser.name}`);
      return new Promise((resolve) => {
        const requestId = foundry.utils.randomID();
        this.pendingInterceptions.set(requestId, { resolve, timeout: Date.now() + 30000 });
        
        // Send request to owner
        game.socket.emit('module.chronoball', {
          action: 'requestSaveType',
          data: { requestId, tokenName: token.name, dc, role },
          targetUserId: ownerUser.id
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          if (this.pendingInterceptions.has(requestId)) {
            ChronoballUtils.log(`Chronoball | Save type request ${requestId} timed out`);
            this.pendingInterceptions.delete(requestId);
            resolve('dex'); // Default to DEX
          }
        }, 30000);
      });
    }
    
    // Fallback
    console.warn('Chronoball | Neither owner nor GM, defaulting to DEX');
    return 'dex';
  }
  
  /**
   * Show save type dialog locally
   */
  static async showSaveTypeDialog(tokenName, dc, role) {
    return new Promise((resolve) => {
      new Dialog({
        title: `Save vs Interception (DC ${dc})`,
        content: `
          <p><strong>${tokenName}</strong>, choose your save:</p>
          <p>An opponent is trying to intercept ${role === 'thrower' ? 'your throw' : 'your catch'}!</p>
          <p style="font-weight: bold; color: #f44336;">DC: ${dc}</p>
        `,
        buttons: {
          str: {
            label: 'STR Save',
            callback: () => {
              ChronoballUtils.log(`Chronoball | STR Save selected by ${tokenName}`);
              resolve('str');
            }
          },
          dex: {
            label: 'DEX Save',
            callback: () => {
              ChronoballUtils.log(`Chronoball | DEX Save selected by ${tokenName}`);
              resolve('dex');
            }
          },
          cancel: {
            label: 'Cancel',
            callback: () => {
              ChronoballUtils.log(`Chronoball | Save type selection cancelled by ${tokenName}`);
              resolve(null);
            }
          }
        },
        default: 'dex',
        close: () => {
          ChronoballUtils.log(`Chronoball | Save type dialog closed by ${tokenName}`);
          resolve(null);
        }
      }).render(true);
    });
  }
  
  /**
   * Perform a save with modification options (owner sees dialog)
   */
  static async performSaveWithModification(token, saveType, dc) {
    const ownerUser = this.getTokenOwner(token);
    
    if (!ownerUser) {
      console.warn(`Chronoball | No owner found for token ${token.name} (id: ${token.id})`);
      return null;
    }
    
    ChronoballUtils.log(`Chronoball | performSaveWithModification - Token: ${token.name} (id: ${token.id}), Actor: ${token.actor.name} (id: ${token.actor.id}), Owner: ${ownerUser.name} (id: ${ownerUser.id}), Current User: ${game.user.name} (id: ${game.user.id})`);
    
    // Check if current user is the owner
    if (game.user.id === ownerUser.id) {
      // This user can roll the save directly
      ChronoballUtils.log(`Chronoball | ✓ Current user IS the owner of ${token.name}, performing save locally`);
      return await this.performSaveLocal(token.actor, saveType, dc);
    } 
    
    // If current user is GM, request save from owner via socket
    if (game.user.isGM) {
      ChronoballUtils.log(`Chronoball | ✓ Current user is GM, requesting save roll from owner ${ownerUser.name} for token ${token.name}`);
      return new Promise((resolve) => {
        const requestId = foundry.utils.randomID();
        this.pendingInterceptions.set(requestId, { resolve, timeout: Date.now() + 60000 });
        
        ChronoballUtils.log(`Chronoball | Sending requestSaveRoll to user ${ownerUser.id} (${ownerUser.name}) for token ${token.name}`);
        
        // Send request to owner to perform save
        game.socket.emit('module.chronoball', {
          action: 'requestSaveRoll',
          data: { 
            requestId, 
            tokenId: token.id,
            actorId: token.actor.id,
            tokenName: token.name, 
            saveType, 
            dc 
          },
          targetUserId: ownerUser.id
        });
        
        // Timeout after 60 seconds
        setTimeout(() => {
          if (this.pendingInterceptions.has(requestId)) {
            ChronoballUtils.log(`Chronoball | ⚠ Save roll request ${requestId} timed out for ${token.name}`);
            this.pendingInterceptions.delete(requestId);
            resolve(null);
          }
        }, 60000);
      });
    }
    
    // Fallback
    console.warn(`Chronoball | ⚠ Neither owner nor GM for token ${token.name}, cannot perform save`);
    return null;
  }
  
  /**
   * Perform a save locally with modification dialog
   */
  static async performSaveLocal(actor, saveType, dc) {
    let roll;
    
    const performRealRoll = async () => {
        try {
            if (actor.system.abilities && actor.system.abilities[saveType]) {
                // CORRECT (V12+) API: rollAbilitySave(config, dialog, message)
                const config = { ability: saveType, targetValue: dc };
                const dialog = {};
                const message = { create: false };
                const rolls = await actor.rollSavingThrow({ ability: saveType, targetValue: dc }, {}, { create: false });
                return rolls?.[0] || null;
            } else {
                // Fallback for non-dnd5e actors
                return new Roll('1d20').evaluate({ async: true });
            }
        } catch (error) {
            console.warn('Chronoball | Save roll error, using fallback 1d20:', error);
            return new Roll('1d20').evaluate({ async: true });
        }
    };

    roll = await performRealRoll();
    if (!roll) return null; // User cancelled the roll dialog

    if (game.settings.get('chronoball', 'allowRollModification')) {
      const modification = await ChronoballUtils.askForRollModification(roll, dc, 'Modify Save Result');
    
      if (modification.cancelled) return null;

      if (modification.reroll) {
        const newRoll = await performRealRoll();
        if (newRoll) {
          const newTotal = newRoll.total;
          const originalTotal = roll.total;

          if (modification.takeHigher) {
            if (newTotal > originalTotal) {
              roll = newRoll;
              ui.notifications.info(`Rerolled save: ${originalTotal} → ${newTotal} (taking higher)`);
            } else {
              ui.notifications.info(`Rerolled save: ${originalTotal} vs ${newTotal} (keeping original)`);
            }
          } else {
            if (newTotal < originalTotal) {
              roll = newRoll;
              ui.notifications.info(`Rerolled save: ${originalTotal} → ${newTotal} (taking lower)`);
            } else {
              ui.notifications.info(`Rerolled save: ${originalTotal} vs ${newTotal} (keeping original)`);
            }
          }
        }
      }
      
      if (modification.bonus) {
        // Re-evaluate the roll with the bonus added.
        const newRoll = await new Roll(`${roll.formula} + ${modification.bonus}`).evaluate({async: true});
        roll = newRoll;
        ui.notifications.info(`Added bonus to save: +${modification.bonus} (New Total: ${roll.total})`);
      }
    }
    
    return {
      roll,
      success: roll.total >= dc
    };
  }
  
  /**
   * Initialize socket listeners for interception system
   */
  static initializeSocketListeners() {
    game.socket.on('module.chronoball', (data) => {
      // Interception request
      if (data.action === 'interceptionRequest' && data.targetUserId === game.user.id) {
        this.showInterceptionDialog(data.data);
      } 
      // Interception response
      else if (data.action === 'interceptionResponse') {
        this.handleInterceptionResponse(data.data.requestId, data.data.accepted);
      }
      // Save type request
      else if (data.action === 'requestSaveType' && data.targetUserId === game.user.id) {
        this.handleSaveTypeRequest(data.data);
      }
      // Save type response
      else if (data.action === 'saveTypeResponse' && game.user.isGM) {
        this.handleSaveTypeResponse(data.data);
      }
      // Save roll request
      else if (data.action === 'requestSaveRoll' && data.targetUserId === game.user.id) {
        this.handleSaveRollRequest(data.data);
      }
      // Save roll response
      else if (data.action === 'saveRollResponse' && game.user.isGM) {
        this.handleSaveRollResponse(data.data);
      }
    });
    
    ChronoballUtils.log('Chronoball | Interception socket listeners initialized');
  }
  
  /**
   * Handle save type request from GM
   */
  static async handleSaveTypeRequest(data) {
    const { requestId, tokenName, dc, role } = data;
    
    ChronoballUtils.log(`Chronoball | Player received save type request for ${tokenName}`);
    
    const saveType = await this.showSaveTypeDialog(tokenName, dc, role);
    
    ChronoballUtils.log(`Chronoball | Player selected ${saveType}, sending back to GM`);
    
    // Send save type back to GM
    game.socket.emit('module.chronoball', {
      action: 'saveTypeResponse',
      data: { requestId, saveType }
    });
  }
  
  /**
   * Handle save type response
   */
  static handleSaveTypeResponse(data) {
    const { requestId, saveType } = data;
    
    ChronoballUtils.log(`Chronoball | GM received save type response: ${saveType} for request ${requestId}`);
    
    if (this.pendingInterceptions.has(requestId)) {
      const { resolve } = this.pendingInterceptions.get(requestId);
      this.pendingInterceptions.delete(requestId);
      ChronoballUtils.log(`Chronoball | Resolving save type promise with: ${saveType}`);
      resolve(saveType);
    } else {
      console.warn(`Chronoball | No pending request found for ${requestId}`);
    }
  }
  
  /**
   * Handle save roll request from GM
   */
  static async handleSaveRollRequest(data) {
    const { requestId, actorId, tokenName, saveType, dc } = data;
    
    ChronoballUtils.log(`Chronoball | Player received save roll request for ${tokenName}, saveType: ${saveType}, DC: ${dc}`);
    
    // Get the actor
    const actor = game.actors.get(actorId);
    if (!actor) {
      console.error(`Chronoball | Actor ${actorId} not found`);
      game.socket.emit('module.chronoball', {
        action: 'saveRollResponse',
        data: { requestId, result: null }
      });
      return;
    }
    
    // Perform the save locally (with modification dialog)
    const saveResult = await this.performSaveLocal(actor, saveType, dc);
    
    ChronoballUtils.log(`Chronoball | Player completed save roll, result:`, saveResult);
    
    // Send result back to GM
    game.socket.emit('module.chronoball', {
      action: 'saveRollResponse',
      data: { 
        requestId, 
        result: saveResult ? {
          total: saveResult.roll.total,
          success: saveResult.success,
          formula: saveResult.roll.formula,
          terms: saveResult.roll.terms
        } : null
      }
    });
  }
  
  /**
   * Handle save roll response from player
   */
  static handleSaveRollResponse(data) {
    const { requestId, result } = data;
    
    ChronoballUtils.log(`Chronoball | GM received save roll response for request ${requestId}:`, result);
    
    if (this.pendingInterceptions.has(requestId)) {
      const { resolve } = this.pendingInterceptions.get(requestId);
      this.pendingInterceptions.delete(requestId);
      
      if (result) {
        // Reconstruct the roll result object
        const rollResult = {
          roll: {
            total: result.total,
            formula: result.formula,
            terms: result.terms
          },
          success: result.success
        };
        ChronoballUtils.log(`Chronoball | Resolving save roll promise with:`, rollResult);
        resolve(rollResult);
      } else {
        ChronoballUtils.log(`Chronoball | Resolving save roll promise with null (cancelled)`);
        resolve(null);
      }
    } else {
      console.warn(`Chronoball | No pending request found for ${requestId}`);
    }
  }
  
  /**
   * Create interception chat message
   */
  static async createInterceptionChatMessage(target, interceptor, dc, rollTotal, success, location) {
    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🛡️</span>
          <span class="message-title">Interception Attempt (${location})</span>
        </div>
        <div class="message-body">
          <p style="margin: 0 0 10px 0;">
            <strong>${interceptor.name}</strong> tries to intercept against <strong>${target.name}</strong>!
          </p>
          <table class="chronoball-stats-table">
            <tr>
              <td class="stat-label">DC:</td>
              <td class="stat-value">${dc}</td>
            </tr>
            <tr>
              <td class="stat-label">Save Roll:</td>
              <td class="stat-value">${rollTotal}</td>
            </tr>
            <tr>
              <td class="stat-label">Result:</td>
              <td class="stat-value" style="font-weight: bold; color: ${success ? '#4CAF50' : '#f44336'};">
                ${success ? 'Save Successful!' : 'Intercepted!'}
              </td>
            </tr>
          </table>
        </div>
      </div>
    `;
    
    await ChronoballChat.createMessage({
      content,
      speaker: { alias: 'Chronoball' }
    });
  }
  
  /**
   * Handle interception response via socket (legacy - might not be needed)
   */
  static async handleResponse(defenderId, accepted, type) {
    ChronoballUtils.log('Chronoball | Interception response:', defenderId, accepted, type);
  }
}