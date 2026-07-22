/**
 * ChronoballInterception - Handles interception and blocking mechanics
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils, SOCKET_TIMEOUT_SHORT_MS, SOCKET_TIMEOUT_LONG_MS } from './utils.js';
import { ChronoballBallExecute } from './ball-execute.js';
import { ChronoballRolls } from './rolls.js';

export class ChronoballInterception {
  static pendingInterceptions = new Map();
  
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
      ChronoballUtils.log(`Chronoball | Asking controller of ${defender.name} for interception decision`);

      const accepted = await this.askInterceptionDecision(defender, rules.interceptTimeout, 'at thrower');
      
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
      ChronoballUtils.log(`Chronoball | Asking controller of ${defender.name} for interception decision at receiver`);

      const accepted = await this.askInterceptionDecision(defender, rules.interceptTimeout, 'at receiver');
      
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

    const matchScene = ChronoballUtils.getMatchScene();
    const candidates = matchScene ? matchScene.tokens : [];
    for (const potentialDefender of candidates) {
      if (potentialDefender.id === token.id) continue;
      if (!potentialDefender.actor) continue;

      // Check if token is on defending team
      const actorTeam = ChronoballState.getTeamAssignment(potentialDefender.actor.id);
      if (actorTeam !== defendingTeam) continue;
      
      // Check if within radius using direct center-to-center distance,
      // because grid/path measurement can overcount or behave unexpectedly
      // for this close-range interception check.
      const pixelDistance = ChronoballUtils.calculatePixelDistance(token, potentialDefender);
      const gridDistance = ChronoballUtils.pixelsToGridDistance(pixelDistance);

      ChronoballUtils.log(`Chronoball | Interception distance ${token.name} -> ${potentialDefender.name}: ${gridDistance} (radius ${radius})`);
      
      if (gridDistance <= radius) {
        defenders.push(potentialDefender);
      }
    }
    
    return defenders;
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
    
    ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.InterceptionAttempt', { name: interceptor.name, dc }));

    // Thrower chooses STR or DEX save
    const saveType = await this.askForSaveType(thrower, dc, 'thrower');
    if (saveType === null) return false; // Cancelled
    
    // Thrower rolls save
    const saveResult = await this.performSaveWithModification(thrower, saveType, dc);
    if (saveResult === null) return false; // Cancelled
    
    // Create chat message
    await this.createInterceptionChatMessage(thrower, interceptor, dc, saveResult.roll.total, saveResult.success, 'thrower', saveResult.modification);

    if (!saveResult.success) {
      // Interception successful - TURNOVER!
      const state = ChronoballState.getMatchState();

      // Get interceptor's team
      const interceptorTeam = ChronoballState.getTeamAssignment(interceptor.actor.id);
      const teamName = interceptorTeam === 'A' ? state.teamAName : state.teamBName;

      // Create turnover chat message
      await ChronoballBallExecute.createTurnoverChatMessage(interceptor, teamName, 'interception');

      // End phase immediately via GM (ball will spawn in new attacking zone)
      await ChronoballSocket.executeAsGM('interceptionTurnover', {
        interceptorId: interceptor.id,
        interceptorTeam,
        location: 'thrower'
      });

      ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.InterceptionSuccess', { name: interceptor.name }));
      return true;
    } else {
      // Save successful - throw continues
      ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.InterceptionFailed', { name: thrower.name }));
      return false;
    }
  }
  
  /**
   * Resolve interception at receiver
   */
  static async resolveInterceptionAtReceiver(receiver, interceptor, thrower) {
    // Calculate DC automatically from interceptor's stats
    const dc = this.calculateInterceptionDC(interceptor);
    
    ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.InterceptionAtReceiver', { name: interceptor.name, dc }));
    
    ChronoballUtils.log(`Chronoball | ====== INTERCEPTION AT RECEIVER ======`);
    ChronoballUtils.log(`Chronoball | Receiver Token: ${receiver.name} (id: ${receiver.id})`);
    ChronoballUtils.log(`Chronoball | Receiver Actor: ${receiver.actor.name} (id: ${receiver.actor.id})`);
    ChronoballUtils.log(`Chronoball | Interceptor: ${interceptor.name}`);
    ChronoballUtils.log(`Chronoball | Current user: ${game.user.name} (id: ${game.user.id})`);
    
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
    await this.createInterceptionChatMessage(receiver, interceptor, dc, saveResult.roll.total, saveResult.success, 'receiver', saveResult.modification);

    if (!saveResult.success) {
      // Interception successful - TURNOVER!
      const state = ChronoballState.getMatchState();

      // Get interceptor's team
      const interceptorTeam = ChronoballState.getTeamAssignment(interceptor.actor.id);
      const teamName = interceptorTeam === 'A' ? state.teamAName : state.teamBName;

      // Create turnover chat message
      await ChronoballBallExecute.createTurnoverChatMessage(interceptor, teamName, 'interception');

      // End phase immediately via GM (ball will spawn in new attacking zone)
      await ChronoballSocket.executeAsGM('interceptionTurnover', {
        interceptorId: interceptor.id,
        interceptorTeam,
        location: 'receiver'
      });

      ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.InterceptionReceiverSuccess', { name: interceptor.name }));
      return true;
    } else {
      // Save successful - receiver gets ball normally
      ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.InterceptionReceiverFailed', { name: receiver.name }));
      return false;
    }
  }
  
  /**
   * Ask defender if they want to intercept - broadcasts to all clients,
   * the client that has the token controlled shows the dialog.
   */
  static async askInterceptionDecision(defender, timeout, location) {
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

      // Check locally: do I have this token controlled?
      const controlled = canvas.tokens.controlled.find(t => t.id === defender.id);
      if (controlled) {
        this.showInterceptionDialog(dialogData);
      }

      // Broadcast to all other clients (no targetUserId)
      game.socket.emit('module.chronoball', {
        action: 'interceptionRequest',
        data: dialogData
      });

      // Set timeout to auto-decline
      setTimeout(() => {
        if (this.pendingInterceptions.has(requestId)) {
          this.pendingInterceptions.delete(requestId);
          const dialogId = `chronoball-intercept-${requestId}`;
          const dialog = foundry.applications.instances?.get(dialogId);
          if (dialog) dialog.close();
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

    const dialogId = `chronoball-intercept-${requestId}`;

    // Auto-decline after timeout — only in remote case (no local pending entry).
    // In the local case, askInterceptionDecisionForOwner already has its own timeout.
    const isRemote = !this.pendingInterceptions.has(requestId);
    const autoDeclineTimeout = isRemote ? setTimeout(() => {
      const dialog = foundry.applications.instances?.get(dialogId);
      if (dialog) dialog.close();
      this.sendInterceptionResponse(requestId, false);
    }, timeout) : null;

    foundry.applications.api.DialogV2.wait({
      window: { title: `${game.i18n.localize('CHRONOBALL.Chat.InterceptionAttemptTitle')} - ${location}`, id: dialogId },
      content: `
        <p>${game.i18n.format('CHRONOBALL.Chat.InterceptQuestion', { name: `<strong>${defenderName}</strong>` })}</p>
        <p style="color: #f00; font-weight: bold;">Time remaining: <span id="timer-${requestId}">${timeout / 1000}s</span></p>
      `,
      buttons: [
        { action: 'yes', label: game.i18n.localize('CHRONOBALL.Chat.InterceptYes'), callback: () => true },
        { action: 'no', label: game.i18n.localize('CHRONOBALL.Chat.InterceptNo'), default: true, callback: () => false }
      ],
      rejectClose: false
    }).then((result) => {
      clearTimeout(autoDeclineTimeout);
      clearInterval(timerInterval);
      this.sendInterceptionResponse(requestId, result === true);
    }).catch(() => {
      clearTimeout(autoDeclineTimeout);
      clearInterval(timerInterval);
      this.sendInterceptionResponse(requestId, false);
    });

    // External timer countdown (DOM-based, started after dialog renders)
    let timeLeft = timeout;
    const timerInterval = setInterval(() => {
      timeLeft -= 1000;
      const timerEl = document.getElementById(`timer-${requestId}`);
      if (timerEl) timerEl.textContent = `${timeLeft / 1000}s`;
      if (timeLeft <= 0) clearInterval(timerInterval);
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
   * Ask for save type (STR or DEX) - broadcasts to controller of token
   */
  static async askForSaveType(token, dc, role) {
    ChronoballUtils.log(`Chronoball | Asking save type for token ${token.name}`);

    // Check locally: do I have this token controlled?
    const controlled = canvas.tokens.controlled.find(t => t.id === token.id);
    if (controlled) {
      ChronoballUtils.log(`Chronoball | Current user controls ${token.name}, showing dialog directly`);
      return await this.showSaveTypeDialog(token.name, dc, role);
    }

    // Broadcast to all clients — the one controlling the token will respond
    ChronoballUtils.log(`Chronoball | Broadcasting save type request for ${token.name}`);
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID();
      this.pendingInterceptions.set(requestId, { resolve, timeout: Date.now() + SOCKET_TIMEOUT_SHORT_MS });

      game.socket.emit('module.chronoball', {
        action: 'requestSaveType',
        data: { requestId, tokenId: token.id, tokenName: token.name, dc, role }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingInterceptions.has(requestId)) {
          ChronoballUtils.log(`Chronoball | Save type request ${requestId} timed out`);
          this.pendingInterceptions.delete(requestId);
          resolve('dex'); // Default to DEX
        }
      }, SOCKET_TIMEOUT_SHORT_MS);
    });
  }
  
  /**
   * Show save type dialog locally
   */
  static async showSaveTypeDialog(tokenName, dc, role) {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format('CHRONOBALL.Chat.SaveVsInterception', { dc }) },
      content: `
        <p>${game.i18n.format('CHRONOBALL.Chat.ChooseSave', { name: `<strong>${tokenName}</strong>` })}</p>
        <p>${role === 'thrower' ? game.i18n.localize('CHRONOBALL.Chat.InterceptYourThrow') : game.i18n.localize('CHRONOBALL.Chat.InterceptYourCatch')}</p>
        <p style="font-weight: bold; color: #f44336;">${game.i18n.localize('CHRONOBALL.Chat.DC')}: ${dc}</p>
      `,
      buttons: [
        { action: 'str', label: game.i18n.localize('CHRONOBALL.Chat.STRSave'), callback: () => { ChronoballUtils.log(`Chronoball | STR Save selected by ${tokenName}`); return 'str'; } },
        { action: 'dex', label: game.i18n.localize('CHRONOBALL.Chat.DEXSave'), default: true, callback: () => { ChronoballUtils.log(`Chronoball | DEX Save selected by ${tokenName}`); return 'dex'; } },
        { action: 'cancel', label: game.i18n.localize('CHRONOBALL.Chat.Cancel'), callback: () => { ChronoballUtils.log(`Chronoball | Save type selection cancelled by ${tokenName}`); return null; } }
      ],
      rejectClose: false
    });
    if (result === undefined) {
      ChronoballUtils.log(`Chronoball | Save type dialog closed by ${tokenName}`);
    }
    return result ?? null;
  }
  
  /**
   * Perform a save with modification options - broadcasts to controller of token
   */
  static async performSaveWithModification(token, saveType, dc) {
    ChronoballUtils.log(`Chronoball | performSaveWithModification - Token: ${token.name} (id: ${token.id}), Actor: ${token.actor.name} (id: ${token.actor.id}), Current User: ${game.user.name} (id: ${game.user.id})`);

    // Check locally: do I have this token controlled?
    const controlled = canvas.tokens.controlled.find(t => t.id === token.id);
    if (controlled) {
      ChronoballUtils.log(`Chronoball | Current user controls ${token.name}, performing save locally`);
      return await this.performSaveLocal(token.actor, saveType, dc);
    }

    // Broadcast to all clients — the one controlling the token will respond
    ChronoballUtils.log(`Chronoball | Broadcasting save roll request for ${token.name}`);
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID();
      this.pendingInterceptions.set(requestId, { resolve, timeout: Date.now() + SOCKET_TIMEOUT_LONG_MS });

      game.socket.emit('module.chronoball', {
        action: 'requestSaveRoll',
        data: {
          requestId,
          tokenId: token.id,
          actorId: token.actor.id,
          tokenName: token.name,
          saveType,
          dc
        }
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingInterceptions.has(requestId)) {
          ChronoballUtils.log(`Chronoball | Save roll request ${requestId} timed out for ${token.name}`);
          this.pendingInterceptions.delete(requestId);
          resolve(null);
        }
      }, SOCKET_TIMEOUT_LONG_MS);
    });
  }
  
  /**
   * Perform a save locally with modification dialog
   */
  static async performSaveLocal(actor, saveType, dc) {
    const rollFn = async () => {
      try {
        if (actor.system.abilities && actor.system.abilities[saveType]) {
          const rolls = await actor.rollSavingThrow({ ability: saveType, target: dc }, {}, { create: false, mode: CONST.DICE_ROLL_MODES.PRIVATE });
          return rolls?.[0] || null;
        } else {
          // Fallback for non-dnd5e actors
          return new Roll('1d20').evaluate();
        }
      } catch (error) {
        console.warn('Chronoball | Save roll error, using fallback 1d20:', error);
        return new Roll('1d20').evaluate();
      }
    };

    return await ChronoballRolls.performRollWithModification(rollFn, dc, game.i18n.localize('CHRONOBALL.Chat.ModifySaveResult'));
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
          terms: saveResult.roll.terms,
          modification: saveResult.modification
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
          success: result.success,
          modification: result.modification || null
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
  static async createInterceptionChatMessage(target, interceptor, dc, rollTotal, success, location, modification) {
    const resultIcon = success ? '✅' : '❌';
    const resultText = success ? game.i18n.localize('CHRONOBALL.Chat.InterceptionSaved') : game.i18n.localize('CHRONOBALL.Chat.InterceptionCaught');
    const modHint = ChronoballRolls.buildModificationHint(modification);

    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🛡️</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.InterceptionAttemptTitle')} (${location})</span>
        </div>
        <div class="message-body">
          <p><strong>${interceptor.name}</strong> vs <strong>${target.name}</strong></p>
          <p>${game.i18n.localize('CHRONOBALL.Chat.DC')} ${dc} | ${game.i18n.localize('CHRONOBALL.Chat.Roll')}: <strong>${rollTotal}</strong> | <span class="message-result ${success ? 'success' : 'failure'}">${resultIcon} ${resultText}</span></p>
          ${modHint}
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({
      content,
      speaker: { alias: 'Chronoball' }
    });
  }
  
}