/**
 * ChronoballBall - Handles ball mechanics (throw, pass, pickup, drop)
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballInterception } from './interception.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils } from './utils.js';
import { ChronoballScoring } from './scoring.js';

export class ChronoballBall {
  static initialize() {
    ChronoballUtils.log('Chronoball | Ball mechanics initialized');
  }
  
  /**
   * Throw ball to a location
   */
  static async throwBall() {
    // Validate
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }
    
    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }
    
    const state = ChronoballState.getMatchState();
    if (state.carrierId !== controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotCarrier'));
      return;
    }
    
    // Get target location FIRST
    const target = await this.getTargetLocation();
    if (!target) return;
    
    const distance = ChronoballUtils.calculateDistance(controlled, target);
    const rules = ChronoballState.getRules();
    const limits = ChronoballState.getMovementLimits();
    
    // Check throw limit (0 means unlimited)
    if (limits.throw > 0 && distance > state.remainingThrow) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.ExceedsLimit'));
      return;
    }
    
    // Check for interception at thrower AFTER target selection
    const interceptedAtThrower = await ChronoballInterception.checkInterceptionAtThrower(controlled);
    if (interceptedAtThrower) {
      return; // Interception successful, stop throw
    }
    
    // Calculate DC
    const dc = this.calculateDC(distance, rules);
    
    // Choose skill
    const skill = await this.chooseSkill();
    if (!skill) return;
    
    // Roll
    const rollResult = await this.performRoll(controlled.actor, skill, dc);
    if (!rollResult) return;
    
    // Execute via socket
    await ChronoballSocket.executeAsGM('throwBall', {
      tokenId: controlled.id,
      targetX: target.x,
      targetY: target.y,
      skill,
      distance,
      dc,
      rollTotal: rollResult.roll.total,
      success: rollResult.success
    });
  }
  
  /**
   * Pass ball to another token
   */
  static async passBall() {
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }
    
    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }
    
    const state = ChronoballState.getMatchState();
    if (state.carrierId !== controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotCarrier'));
      return;
    }
    
    // Get targeted token FIRST
    const targets = Array.from(game.user.targets);
    if (targets.length === 0) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.TargetFirst'));
      return;
    }

    if (targets.length > 1) {
      ui.notifications.warn(game.i18n.localize('CHRONOBALL.Errors.MultipleTargets'));
    }

    const targetToken = targets[0];

    if (!targetToken) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoTarget'));
      return;
    }

    // Don't allow passing to self
    if (targetToken.id === controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.CannotPassToSelf'));
      return;
    }
    
    const distance = ChronoballUtils.calculateDistance(controlled, targetToken);
    const rules = ChronoballState.getRules();
    const limits = ChronoballState.getMovementLimits();
    
    // Check throw limit (0 means unlimited)
    if (limits.throw > 0 && distance > state.remainingThrow) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.ExceedsLimit'));
      return;
    }
    
    // Check for interception at thrower AFTER target selection
    const interceptedAtThrower = await ChronoballInterception.checkInterceptionAtThrower(controlled);
    if (interceptedAtThrower) {
      return; // Interception successful, stop pass
    }
    
    // Calculate DC
    const dc = this.calculateDC(distance, rules);
    
    // Choose skill
    const skill = await this.chooseSkill();
    if (!skill) return;
    
    // Roll
    const rollResult = await this.performRoll(controlled.actor, skill, dc);
    if (!rollResult) return;
    
    // Execute via socket (interception at receiver will be checked there)
    await ChronoballSocket.executeAsGM('passBall', {
      tokenId: controlled.id,
      targetTokenId: targetToken.id,
      skill,
      distance,
      dc,
      rollTotal: rollResult.roll.total,
      success: rollResult.success
    });
  }
  
  /**
   * Pick up ball
   */
  static async pickupBall() {
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }
    
    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }
    
    const ballToken = ChronoballState.getBallToken();
    if (!ballToken) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoBall'));
      return;
    }
    
    // Check if token is adjacent to ball
    const distance = ChronoballUtils.calculateDistance(controlled, ballToken);
    if (distance > 5) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.InvalidTarget'));
      return;
    }
    
    // Execute via socket
    await ChronoballSocket.executeAsGM('pickupBall', {
      tokenId: controlled.id
    });
  }
  
  /**
   * Drop ball
   */
  static async dropBall() {
    if (!canvas.scene) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoScene'));
      return;
    }
    
    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }
    
    const state = ChronoballState.getMatchState();
    if (state.carrierId !== controlled.id) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NotCarrier'));
      return;
    }
    
    // Get target location within 5ft
    ui.notifications.info(game.i18n.localize('CHRONOBALL.Notifications.ClickToDrop'));
    const target = await this.getTargetLocationWithinRadius(controlled, 5);
    if (!target) {
      ui.notifications.warn(game.i18n.localize('CHRONOBALL.Notifications.DropCancelled'));
      return;
    }
    
    // Execute via socket
    await ChronoballSocket.executeAsGM('dropBall', {
      tokenId: controlled.id,
      dropX: target.x,
      dropY: target.y
    });
  }
  
  /**
   * Set carrier (GM only)
   */
  static async setCarrier(tokenId) {
    if (!game.user.isGM) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoGM'));
      return;
    }
    
    const token = canvas.tokens.get(tokenId);
    if (!token) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }
    
    await ChronoballSocket.executeAsGM('setCarrier', { tokenId });
  }
  
  /**
   * Clear carrier (GM only)
   */
  static async clearCarrier() {
    if (!game.user.isGM) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoGM'));
      return;
    }
    
    await ChronoballSocket.executeAsGM('clearCarrier', {});
  }
  
  // Authoritative execution methods (called by socket)
  
  static async executeThrow(tokenId, targetX, targetY, skill, distance, dc, rollTotal, success) {
    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    const rules = ChronoballState.getRules();

    // Get or create ball token at carrier position
    let ballToken = ChronoballState.getBallToken();

    // If ball doesn't exist (was deleted when picked up), create it temporarily at carrier
    if (!ballToken) {
      await this.recreateBallToken(token.x, token.y);
      ballToken = ChronoballState.getBallToken();
    }

    if (!ballToken) {
      console.error('Chronoball | Could not create ball token for throw');
      return;
    }

    // Adjust for token center
    const gridSize = canvas.grid.size;
    const adjustedX = targetX - (gridSize / 2);
    const adjustedY = targetY - (gridSize / 2);

    if (success) {
      // Throw was successful - ball reaches target
      ChronoballUtils.log(`Chronoball | Successful throw: ${distance}ft to (${adjustedX}, ${adjustedY})`);

      // IMPORTANT: Clear carrier FIRST, before animation, to ensure effects are removed
      await this.executeClearCarrier();

      // Set flag to prevent updateToken hook from triggering scoring during animation
      await ChronoballState.updateState({ throwInProgress: true });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to TRUE');

      // Deduct from remaining throw distance
      await ChronoballState.deductThrowDistance(distance);

      // Animate ball flying with Sequencer
      if (game.modules.get('sequencer')?.active && ballToken) {
        ChronoballUtils.log('Chronoball | Starting Sequencer animation...');

        const sequence = new Sequence()
          .animation()
          .on(ballToken)
          .moveTowards({ x: adjustedX, y: adjustedY }, { ease: "easeOutCubic" })
          .duration(1500)
          .waitUntilFinished(-1);

        await sequence.play();
        ChronoballUtils.log('Chronoball | Sequencer animation completed');

        await ballToken.document.update({ x: adjustedX, y: adjustedY }, { chronoball_internal: true });
        ChronoballUtils.log('Chronoball | Ball position updated to target');
      } else {
        // Fallback: Move ball instantly if Sequencer not available
        ChronoballUtils.log('Chronoball | Sequencer not active, moving ball instantly');
        if (ballToken) {
          await ballToken.document.update({ x: adjustedX, y: adjustedY }, { chronoball_internal: true });
        }
      }

      // Let the ball sit at the target for a moment (500ms) before scoring
      ChronoballUtils.log('Chronoball | Ball at target, waiting 500ms before scoring check...');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear the flag BEFORE scoring check
      await ChronoballState.updateState({ throwInProgress: false });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to FALSE');

      // Check for scoring (ball landed in endzone) AFTER animation and delay
      await ChronoballScoring.checkThrowScore(ballToken.document, targetX, targetY);

      // Create chat message
      await this.createThrowChatMessage(token, distance, distance, dc, rollTotal, true);

      ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.BallThrownSuccess', { distance: Math.round(distance) }));

    } else {
      // Failed throw - ball falls short
      const achievedDistance = this.calculateAchievedDistance(rollTotal, distance, rules);

      // Adjust for token center before calculating path
      const adjustedTargetX = targetX - (gridSize / 2);
      const adjustedTargetY = targetY - (gridSize / 2);

      // Calculate position along the path to the adjusted target
      const ratio = distance > 0 ? achievedDistance / distance : 0;
      const actualX = Math.round(token.x + (adjustedTargetX - token.x) * ratio);
      const actualY = Math.round(token.y + (adjustedTargetY - token.y) * ratio);

      ChronoballUtils.log(`Chronoball | Failed throw: Intended ${distance}ft, achieved ${achievedDistance}ft (${Math.round(ratio * 100)}%)`);

      // IMPORTANT: Clear carrier FIRST, before animation
      await this.executeClearCarrier();

      // Set flag to prevent updateToken hook from triggering scoring during animation
      await ChronoballState.updateState({ throwInProgress: true });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to TRUE (partial throw)');

      // Deduct only the actual distance
      await ChronoballState.deductThrowDistance(achievedDistance);

      // Animate ball flying with Sequencer to partial distance
      if (game.modules.get('sequencer')?.active && ballToken) {
        ChronoballUtils.log('Chronoball | Starting Sequencer animation (partial throw)...');

        const sequence = new Sequence()
          .animation()
          .on(ballToken)
          .moveTowards({ x: actualX, y: actualY }, { ease: "easeOutCubic" })
          .duration(1500)
          .waitUntilFinished(-1);

        await sequence.play();
        ChronoballUtils.log('Chronoball | Sequencer animation completed');

        await ballToken.document.update({ x: actualX, y: actualY }, { chronoball_internal: true });
      } else {
        // Fallback: Move ball instantly
        if (ballToken) {
          await ballToken.document.update({ x: actualX, y: actualY }, { chronoball_internal: true });
        }
      }

      // Let the ball sit for a moment before scoring check
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear the flag BEFORE scoring check
      await ChronoballState.updateState({ throwInProgress: false });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to FALSE');

      // Check for scoring even on failed throw (might still land in endzone)
      await ChronoballScoring.checkThrowScore(ballToken.document, actualX, actualY);

      // Create chat message
      await this.createThrowChatMessage(token, distance, achievedDistance, dc, rollTotal, false);

      ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.ThrowFellShort', { achieved: Math.round(achievedDistance), distance: Math.round(distance) }));
    }
  }
  
  static async executePass(tokenId, targetTokenId, skill, distance, dc, rollTotal, success) {
    const token = canvas.tokens.get(tokenId);
    const targetToken = canvas.tokens.get(targetTokenId);
    if (!token || !targetToken) return;
    
    const rules = ChronoballState.getRules();
    
    // Get or create ball token at carrier position
    let ballToken = ChronoballState.getBallToken();
    
    // If ball doesn't exist (was deleted when picked up), create it temporarily at carrier
    if (!ballToken) {
      await this.recreateBallToken(token.x, token.y);
      ballToken = ChronoballState.getBallToken();
    }
    
    if (success) {
      // Pass was successful, now check for interception at receiver
      const interceptedAtReceiver = await ChronoballInterception.checkInterceptionAtReceiver(targetToken, token);
      
      if (interceptedAtReceiver) {
        // Ball was intercepted at receiver - interception.js handles the turnover
        // Just animate and create chat message
        const targetX = targetToken.x;
        const targetY = targetToken.y;
        
        // Deduct from remaining throw distance
        await ChronoballState.deductThrowDistance(distance);
        
        // Animate ball flying
        if (game.modules.get('sequencer')?.active && ballToken) {
          const sequence = new Sequence()
            .animation()
            .on(ballToken)
            .moveTowards({ x: targetX, y: targetY }, { ease: "easeOutCubic" })
            .duration(1500)
            .waitUntilFinished();
          
          await sequence.play();
          
          await ballToken.document.update({ x: targetX, y: targetY });
        } else {
          if (ballToken) {
            await ballToken.document.update({ x: targetX, y: targetY });
          }
        }
        
        // Create chat message for successful pass but intercepted
        await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, true, null, true);
        
        return; // Exit - interception handled in interception.js
      }
      
      // No interception - receiver gets ball normally
      const targetX = targetToken.x;
      const targetY = targetToken.y;
      
      // Deduct from remaining throw distance
      await ChronoballState.deductThrowDistance(distance);

      // Check if receiver is in target endzone (for pass-in-zone score)
      const state = ChronoballState.getMatchState();
      const targetZoneId = state.attackingTeam === 'A' ? rules.zoneBTileId : rules.zoneATileId;

      // Check if pass was completed in endzone
      const receiverInEndzone = ChronoballState.isTokenCenterInTile(targetToken.document, targetToken.x, targetToken.y, targetZoneId);
      
      // Animate ball flying with Sequencer
      if (game.modules.get('sequencer')?.active && ballToken) {
        const sequence = new Sequence()
          .animation()
          .on(ballToken)
          .moveTowards({ x: targetX, y: targetY }, { ease: "easeOutCubic" })
          .duration(1500) // 1.5 seconds
          .waitUntilFinished();
        
        await sequence.play();
        
        // Update final position
        await ballToken.document.update({ x: targetX, y: targetY });
      } else {
        // Fallback: Move token instantly
        if (ballToken) {
          await ballToken.document.update({ x: targetX, y: targetY });
        }
      }
      
      // Delete ball token and set receiver as carrier
      if (ballToken) {
        await ballToken.document.delete();
        await ChronoballState.updateState({ ballTokenId: null });
      }
      
      // Clear old carrier and set new carrier
      await this.executeClearCarrier();
      await this.executeSetCarrier(targetTokenId);
      
      // If receiver caught in endzone, award pass-in-zone score
      if (receiverInEndzone) {
        await ChronoballScoring.awardPassInZoneScore(state.attackingTeam);
        // Create chat message for pass-in-zone score
        await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, true, null, false, true);
      } else {
        // Normal pass completion
        // Create chat message
        await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, true);
      }
      
      ui.notifications.info(game.i18n.localize('CHRONOBALL.Chat.PassTitle'));
      
    } else {
      // Failed pass - ball falls short
      const achievedDistance = this.calculateAchievedDistance(rollTotal, distance, rules);
      
      // Calculate position along the path
      const ratio = achievedDistance / distance;
      const actualX = token.x + (targetToken.x - token.x) * ratio;
      const actualY = token.y + (targetToken.y - token.y) * ratio;
      
      ChronoballUtils.log(`Chronoball | Failed pass: Intended ${distance}ft, achieved ${achievedDistance}ft (${Math.round(ratio * 100)}%)`);
      
      // Deduct only the actual distance
      await ChronoballState.deductThrowDistance(achievedDistance);
      
      // Animate ball flying with Sequencer to partial distance
      if (game.modules.get('sequencer')?.active && ballToken) {
        const sequence = new Sequence()
          .animation()
          .on(ballToken)
          .moveTowards({ x: actualX, y: actualY }, { ease: "easeOutCubic" })
          .duration(1500)
          .waitUntilFinished();
        
        await sequence.play();
        
        await ballToken.document.update({ x: actualX, y: actualY });
      } else {
        if (ballToken) {
          await ballToken.document.update({ x: actualX, y: actualY });
        } else {
          await this.recreateBallToken(actualX, actualY);
        }
      }
      
      // Clear carrier (ball is now on the ground)
      await this.executeClearCarrier();
      
      // Create chat message
      await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, false, achievedDistance);
      
      ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.PassFellShort', { achieved: Math.round(achievedDistance), distance: Math.round(distance) }));
    }
  }
  
  /**
   * Calculate achieved distance based on roll result and DC ladder
   */
  static calculateAchievedDistance(rollTotal, targetDistance, rules) {
    const baseDC = rules.baseDC || 10;
    const stepDistance = rules.stepDistance || 10;
    const dcIncrease = rules.dcIncrease || 2;
    
    // If roll is below base DC, ball travels minimum distance
    if (rollTotal < baseDC) {
      return Math.max(stepDistance, 5); // At least 5ft or one step
    }
    
    // Calculate how many DC steps were achieved
    const dcDifference = rollTotal - baseDC;
    const stepsAchieved = Math.floor(dcDifference / dcIncrease);
    
    // Calculate distance achieved
    const achievedDistance = stepDistance + (stepsAchieved * stepDistance);
    
    // Don't exceed target distance
    return Math.min(achievedDistance, targetDistance);
  }
  
  static async executePickup(tokenId) {
    // Ensure this runs as GM
    if (!game.user.isGM) {
      console.error('Chronoball | executePickup called by non-GM, this should not happen!');
      return;
    }
    
    const token = canvas.tokens.get(tokenId);
    if (!token) return;
    
    const state = ChronoballState.getMatchState();
    
    // Check if this is a defender picking up the ball
    const actorTeam = ChronoballState.getTeamAssignment(token.actor.id);
    const isDefender = (actorTeam === state.defendingTeam);
    
    if (isDefender) {
      // Defender picked up ball = TURNOVER!
      const teamName = actorTeam === 'A' ? state.teamAName : state.teamBName;
      
      // Create turnover chat message
      await this.createTurnoverChatMessage(token, teamName, 'pickup');
      
      // End phase immediately (ball will spawn in new attacking zone)
      await ChronoballState.endPhase();
      
      ui.notifications.notify(`${teamName} recovered the ball! Turnover!`);
      
    } else {
      // Attacker picked up ball normally
      // Set as carrier
      await this.executeSetCarrier(tokenId);
      
      // Delete the ball token (carrier has the ball now)
      const ballToken = ChronoballState.getBallToken();
      if (ballToken) {
        await ballToken.document.delete();
        // Clear the ball token ID from state (will be recreated when thrown/dropped)
        await ChronoballState.updateState({ ballTokenId: null });
      }
      
      // Create chat message
      await this.createPickupChatMessage(token);
      
      ui.notifications.info(game.i18n.localize('CHRONOBALL.Chat.PickupTitle'));
    }
  }
  
  static async executeDrop(tokenId, dropX, dropY) {
    // Ensure this runs as GM
    if (!game.user.isGM) {
      console.error('Chronoball | executeDrop called by non-GM, this should not happen!');
      return;
    }
    
    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    let ballX = token.x;
    let ballY = token.y;
    
    if (dropX !== undefined && dropY !== undefined) {
      // The ball is always 1x1 grid units, so its dimensions are the grid size.
      const ballPixelWidth = canvas.grid.size;
      const ballPixelHeight = canvas.grid.size;
      
      // Adjust clicked position to be the top-left corner for centering the ball
      ballX = dropX - (ballPixelWidth / 2);
      ballY = dropY - (ballPixelHeight / 2);
      
      ChronoballUtils.log(`Chronoball | Dropping ball centered at clicked position: (${ballX}, ${ballY})`);
    } else {
      ChronoballUtils.log(`Chronoball | Dropping ball at carrier position: (${ballX}, ${ballY})`);
    }
    
    // Recreate ball token at drop position
    await this.recreateBallToken(ballX, ballY);
    
    // Clear carrier
    await this.executeClearCarrier();
    
    // Create chat message
    await this.createDropChatMessage(token);
    
    ui.notifications.info(game.i18n.localize('CHRONOBALL.Chat.DropTitle'));
  }

  static async executeFumble(tokenId) {
    if (!game.user.isGM) {
      console.error('Chronoball | executeFumble called by non-GM, this should not happen!');
      return;
    }

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    // --- Scatterball Logic ---
    const scatterRadiusFeet = 5;
    const gridSize = canvas.grid.size;
    const gridDistance = canvas.grid.distance;
    const scatterRadiusPixels = (scatterRadiusFeet / gridDistance) * gridSize;

    // Get a random angle and distance
    const randomAngle = Math.random() * 2 * Math.PI; // 0 to 2PI
    const randomDistance = Math.random() * scatterRadiusPixels; // 0 to radius

    // Calculate the new position
    const newX = token.x + Math.cos(randomAngle) * randomDistance;
    const newY = token.y + Math.sin(randomAngle) * randomDistance;
    // --- End Scatterball Logic ---


    // Recreate ball token at the new scattered position
    await this.recreateBallToken(newX, newY);

    // Clear carrier status
    await this.executeClearCarrier();

    // Create a chat message for the fumble
    const content = `
      <div class="chronoball-chat-message failure">
        <div class="message-header">
          <span class="message-icon">💥</span>
          <span class="message-title">FUMBLE!</span>
        </div>
        <div class="message-body">
          <p><strong>${token.name}</strong> fumbles and drops the ball!</p>
        </div>
      </div>
    `;
    await ChronoballChat.createMessage({ content, speaker: { alias: 'Chronoball' } });

    ui.notifications.warn(game.i18n.format('CHRONOBALL.Chat.FumbleFailed', { name: token.name }));
  }
  
  /**
   * Recreate ball token at specified position
   */
  static async recreateBallToken(x, y) {
    const rules = ChronoballState.getRules();
    
    // Find or create ball actor robustly
    const ballActor = await ChronoballState.getOrCreateBallActor();
    
    if (!ballActor) {
      console.error('Chronoball | Could not find or create the ball actor.');
      return;
    }
    
    // Create new ball token
    const tokenData = {
      name: 'Chronoball',
      actorId: ballActor.id,
      x: x,
      y: y,
      texture: {
        src: rules.ballTexture || 'icons/svg/item-bag.svg'
      },
      width: 1,
      height: 1,
      scale: rules.ballScale || 1.0,
      disposition: 0,
      lockRotation: true,
      displayName: 0, // Never show name (DISPLAYNAME_NEVER)
      displayBars: 0 // Never show bars
    };
    
    const createdTokens = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    
    if (createdTokens && createdTokens.length > 0) {
      await ChronoballState.setBallToken(createdTokens[0].id);
      ChronoballUtils.log('Chronoball | Ball token recreated at:', x, y);
    }
  }
  
  static async executeSetCarrier(tokenId) {
    // Ensure this runs as GM
    if (!game.user.isGM) {
      console.error('Chronoball | executeSetCarrier called by non-GM, this should not happen!');
      return;
    }
    
    const token = canvas.tokens.get(tokenId);
    if (!token) return;
    
    // Clear any existing carrier first
    const currentCarrier = ChronoballState.getCarrierToken();
    if (currentCarrier) {
      await this.removeCarrierEffects(currentCarrier);
    }
    
    // Set new carrier
    await ChronoballState.setCarrierStatus(tokenId, true);
    await this.applyCarrierEffects(token);
    
    ChronoballUtils.log('Chronoball | Carrier set:', token.name);
  }
  
  static async executeClearCarrier() {
    const carrier = ChronoballState.getCarrierToken();
    if (!carrier) return;
    
    await this.removeCarrierEffects(carrier);
    await ChronoballState.setCarrierStatus(carrier.id, false);
    await ChronoballState.updateState({ carrierId: null });
    
    ChronoballUtils.log('Chronoball | Carrier cleared');
  }
  
  // Helper methods
  
  static async applyCarrierEffects(token) {
    const rules = ChronoballState.getRules();
    
    // Store carrier flag on token document (this works for all users)
    await token.document.setFlag('chronoball', 'isCarrier', true);
    await token.document.setFlag('chronoball', 'carrierTempHP', rules.carrierTempHP || 0);
    // Save previous temp HP so we can restore/remove on loss of possession
    try {
      const prev = Number(token?.actor?.system?.attributes?.hp?.temp ?? 0);
      await token.document.setFlag('chronoball', 'prevTempHP', isNaN(prev) ? 0 : prev);
    } catch (e) {
      console.warn('Chronoball | Could not store prevTempHP:', e);
    }

    // ✅ Grant Temp HP to the carrier (GM-side, safe)
    try {
      const actor = token.actor;
      const grant = Number(rules.carrierTempHP) || 0;
      if (grant > 0 && actor?.system?.attributes?.hp) {
        const current = Number(actor.system.attributes.hp.temp ?? 0);
        // 5e semantics: don't stack temp HP; replace only if higher
        const newTemp = Math.max(current, grant);
        if (!Number.isNaN(newTemp) && newTemp !== current) {
          await actor.update({ 'system.attributes.hp.temp': newTemp });
        }
      }
    } catch (err) {
      console.warn('Chronoball | Could not apply temp HP to carrier:', err);
    }

    
    // Apply Sequencer aura if configured
    if (rules.carrierAuraSource && game.modules.get('sequencer')?.active) {
      await this.applySequencerAura(token, rules);
    }
    
    // Note: We do NOT update actor.system.attributes.hp.temp here anymore
    // The GM or player can manually adjust temp HP if needed
    // This avoids permission issues
    
    ChronoballUtils.log(`Chronoball | Carrier effects applied to ${token.name} (temp HP noted: ${rules.carrierTempHP})`);
    
    // Trigger a re-render of the token
    token.refresh();
  }
  
  static async applySequencerAura(token, rules) {
    // Remove any existing aura first
    await Sequencer.EffectManager.endEffects({ name: `chronoball-aura-${token.id}` });
    
    // Create persistent aura effect
    const auraEffect = new Sequence()
      .effect()
      .file(rules.carrierAuraSource)
      .attachTo(token, { bindAlpha: false })
      .scale(rules.carrierAuraScale || 1.5)
      .fadeIn(500)
      .fadeOut(500)
      .opacity(0.8)
      .persist()
      .name(`chronoball-aura-${token.id}`);
    
    await auraEffect.play();
    
    ChronoballUtils.log(`Chronoball | Sequencer aura applied to ${token.name}`);
  }
  
  static async removeCarrierEffects(token) {
    // Remove carrier flags
    await token.document.unsetFlag('chronoball', 'isCarrier');
    await token.document.unsetFlag('chronoball', 'carrierTempHP');
    
    // Remove/restore Temp HP that were granted for carrying the ball
    try {
      const actor = token.actor;
      const hasHP = !!actor?.system?.attributes?.hp;
      if (hasHP) {
        const grant = Number((await token.document.getFlag('chronoball', 'carrierTempHP')) ?? 0);
        const prev = Number((await token.document.getFlag('chronoball', 'prevTempHP')) ?? 0);
        const current = Number(actor.system.attributes.hp.temp ?? 0);
        let newTemp = current;
        if (!Number.isNaN(prev)) {
          // Restore to previous temp HP but never increase (avoid healing temp HP)
          newTemp = Math.min(current, Math.max(prev, 0));
        } else if (!Number.isNaN(grant) && grant > 0) {
          // Fallback for older saves: drop temp HP if it looks like it's from carrier
          if (current <= grant) newTemp = 0;
        }
        if (newTemp !== current) {
          await actor.update({ 'system.attributes.hp.temp': newTemp });
        }
      }
    } catch (err) {
      console.warn('Chronoball | Could not remove/restore carrier Temp HP:', err);
    }
    // Clear helper flags
    await token.document.unsetFlag('chronoball', 'prevTempHP');

    
    // Remove Sequencer aura if it exists
    if (game.modules.get('sequencer')?.active) {
      await Sequencer.EffectManager.endEffects({ name: `chronoball-aura-${token.id}` });
      ChronoballUtils.log(`Chronoball | Sequencer aura removed from ${token.name}`);
    }
    
    ChronoballUtils.log(`Chronoball | Carrier effects removed from ${token.name}`);
    
    // Temp HP restored/removed on loss of possession
    // The GM or player can manually adjust if needed
    
    // Trigger a re-render of the token
    token.refresh();
  }
  
  static calculateDC(distance, rules) {
    const baseDC = rules.baseDC || 10;
    const stepDistance = rules.stepDistance || 10;
    const dcIncrease = rules.dcIncrease || 2;
    
    const steps = Math.floor(distance / stepDistance);
    return baseDC + (steps * dcIncrease);
  }
  
  static async getTargetLocation() {
    return new Promise((resolve) => {
      const handler = (event) => {
        // Get canvas position from mouse event
        const pos = canvas.mousePosition;
        
        canvas.stage.off('click', handler);
        
        if (pos) {
          resolve({ x: pos.x, y: pos.y });
        } else {
          resolve(null);
        }
      };
      
      canvas.stage.on('click', handler);
      ui.notifications.info(game.i18n.localize('CHRONOBALL.Notifications.ClickToTarget'));
      
      // Timeout after 30 seconds
      setTimeout(() => {
        canvas.stage.off('click', handler);
        resolve(null);
      }, 30000);
    });
  }
  
  static async getTargetLocationWithinRadius(token, radiusFeet) {
    return new Promise((resolve) => {
      const gridSize = canvas.grid.size;
      const gridDistance = canvas.grid.distance;
      const radiusPixels = (radiusFeet / gridDistance) * gridSize;
      
      const handler = (event) => {
        // Get canvas position from mouse event
        const pos = canvas.mousePosition;
        
        if (pos) {
          // Calculate distance from token center
          const tokenCenterX = token.x + (token.w / 2);
          const tokenCenterY = token.y + (token.h / 2);
          const dx = pos.x - tokenCenterX;
          const dy = pos.y - tokenCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance <= radiusPixels) {
            canvas.stage.off('click', handler);
            resolve({ x: pos.x, y: pos.y });
          } else {
            ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.TooFar', { distance: radiusFeet }));
          }
        }
      };
      
      canvas.stage.on('click', handler);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        canvas.stage.off('click', handler);
        resolve(null);
      }, 30000);
    });
  }
  
  static async chooseSkill() {
    const skills = this.getAvailableSkills();
    
    return new Promise((resolve) => {
      new Dialog({
        title: game.i18n.localize('CHRONOBALL.Chat.SkillChoice'),
        content: `
          <form>
            <div class="form-group">
              <label>${game.i18n.localize('CHRONOBALL.Chat.ChooseSkill')}</label>
              <select name="skill">
                ${skills.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
              </select>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            label: 'OK',
            callback: (html) => {
              const skill = html.find('[name="skill"]').val();
              resolve(skill);
            }
          },
          cancel: {
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'ok'
      }).render(true);
    });
  }
  
  static getAvailableSkills() {
    const rules = ChronoballState.getRules();
    const skillsString = rules.availableSkills;

    if (!skillsString || typeof skillsString !== 'string') {
      return [
        { id: 'ath', label: 'Athletics' },
        { id: 'slt', label: 'Sleight of Hand' },
        { id: 'acr', label: 'Acrobatics' }
      ];
    }

    return skillsString.split(',').map(s => {
      const parts = s.trim().split(':');
      return { id: parts[0], label: parts[1] || parts[0] };
    }).filter(s => s.id && s.label);
  }
  
  static async performRoll(actor, skill, dc) {
    let roll;

    const performRealRoll = async () => {
        try {
            if (actor.system.skills && actor.system.skills[skill]) {
                // Use the D&D 5e roll dialog (DnD5e 4.1+ API)
                const config = { skill: skill, targetValue: dc };
                const dialog = {};
                const message = { create: false };
                const rolls = await actor.rollSkill(config, dialog, message);
                return rolls?.[0] || null;
            } else {
                // Fallback for non-dnd5e actors
                const advantage = await this.askForAdvantage();
                let formula = '1d20';
                if (advantage === 1) formula = '2d20kh';
                if (advantage === -1) formula = '2d20kl';
                return new Roll(formula).evaluate({ async: true });
            }
        } catch (error) {
            console.warn('Chronoball | Roll error, using fallback 1d20:', error);
            return new Roll('1d20').evaluate({ async: true });
        }
    };

    roll = await performRealRoll();
    if (!roll) return null; // User cancelled the roll dialog

    if (game.settings.get('chronoball', 'allowRollModification')) {
      const modification = await ChronoballUtils.askForRollModification(roll, dc, game.i18n.localize('CHRONOBALL.Chat.ModifyRoll'));
    
      if (modification.cancelled) return null;

      if (modification.reroll) {
        const newRoll = await performRealRoll();
        if (newRoll) {
          const newTotal = newRoll.total;
          const originalTotal = roll.total;

          if (modification.takeHigher) {
            if (newTotal > originalTotal) {
              roll = newRoll;
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledHigher', { original: originalTotal, new: newTotal }));
            } else {
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledKeptOriginal', { original: originalTotal, new: newTotal }));
            }
          } else {
            if (newTotal < originalTotal) {
              roll = newRoll;
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledLower', { original: originalTotal, new: newTotal }));
            } else {
              ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.RerolledKeptOriginal', { original: originalTotal, new: newTotal }));
            }
          }
        }
      }
      
      if (modification.bonus) {
        const newRoll = await new Roll(`${roll.formula} + ${modification.bonus}`).evaluate({async: true});
        roll = newRoll;
        ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.AddedBonus', { bonus: modification.bonus, total: roll.total }));
      }
    }
    
    return {
      roll,
      success: roll.total >= dc
    };
  }
  
  static async askForAdvantage() {
    return new Promise((resolve) => {
      new Dialog({
        title: 'Roll Mode',
        content: '<p>Choose roll mode:</p>',
        buttons: {
          advantage: {
            label: 'Advantage',
            callback: () => resolve(1)
          },
          normal: {
            label: 'Normal',
            callback: () => resolve(0)
          },
          disadvantage: {
            label: 'Disadvantage',
            callback: () => resolve(-1)
          }
        },
        default: 'normal'
      }).render(true);
    });
  }
  
  // Chat message helpers
  
  static async createThrowChatMessage(token, targetDistance, actualDistance, dc, rollTotal, success) {
    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🎯</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.ThrowTitle')}</span>
        </div>
        <div class="message-body">
          <p style="margin: 0 0 10px 0;"><strong>${token.name}</strong> throws the ball!</p>
          <table class="chronoball-stats-table">
            <tr>
              <td class="stat-label">${success ? game.i18n.localize('CHRONOBALL.Chat.Distance') : 'Target'}:</td>
              <td class="stat-value">${success ? actualDistance : targetDistance} ft</td>
            </tr>
            ${!success ? `
            <tr>
              <td class="stat-label">Achieved:</td>
              <td class="stat-value" style="color: #ff9800;">${actualDistance} ft</td>
            </tr>
            ` : ''}
            <tr>
              <td class="stat-label">${game.i18n.localize('CHRONOBALL.Chat.DC')}:</td>
              <td class="stat-value">${dc}</td>
            </tr>
            <tr>
              <td class="stat-label">${game.i18n.localize('CHRONOBALL.Chat.Roll')}:</td>
              <td class="stat-value">${rollTotal}</td>
            </tr>
            <tr>
              <td class="stat-label">Result:</td>
              <td class="stat-value" style="font-weight: bold; color: ${success ? '#4CAF50' : '#f44336'};">
                ${success ? game.i18n.localize('CHRONOBALL.Chat.Success') : game.i18n.localize('CHRONOBALL.Chat.Failure')}
              </td>
            </tr>
          </table>
        </div>
      </div>
    `;
    
    await ChronoballChat.createMessage({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }
  
  static async createPassChatMessage(token, targetToken, targetDistance, dc, rollTotal, success, actualDistance, intercepted, passInZone) {
    actualDistance = actualDistance || null;
    intercepted = intercepted || false;
    passInZone = passInZone || false;
    
    let distanceInfo;
    if (success) {
      distanceInfo = `${targetDistance} ft`;
    } else {
      distanceInfo = `${actualDistance} ft (target: ${targetDistance} ft)`;
    }
    
    let resultText = success ? game.i18n.localize('CHRONOBALL.Chat.Success') : game.i18n.localize('CHRONOBALL.Chat.Failure');
    let resultColor = success ? '#4CAF50' : '#f44336';
    
    if (intercepted) {
      resultText = 'Pass Complete - But Intercepted!';
      resultColor = '#ff9800';
    }
    
    if (passInZone) {
      resultText = 'Pass Complete in Endzone - SCORE!';
      resultColor = '#FFD700';
    }
    
    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🤝</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.PassTitle')}</span>
        </div>
        <div class="message-body">
          <p style="margin: 0 0 10px 0;">
            <strong>${token.name}</strong> ${success ? 'passes to' : 'attempts to pass to'} <strong>${targetToken.name}</strong>!
          </p>
          <table class="chronoball-stats-table">
            <tr>
              <td class="stat-label">${success ? game.i18n.localize('CHRONOBALL.Chat.Distance') : 'Target'}:</td>
              <td class="stat-value">${distanceInfo}</td>
            </tr>
            <tr>
              <td class="stat-label">${game.i18n.localize('CHRONOBALL.Chat.DC')}:</td>
              <td class="stat-value">${dc}</td>
            </tr>
            <tr>
              <td class="stat-label">${game.i18n.localize('CHRONOBALL.Chat.Roll')}:</td>
              <td class="stat-value">${rollTotal}</td>
            </tr>
            <tr>
              <td class="stat-label">Result:</td>
              <td class="stat-value" style="font-weight: bold; color: ${resultColor};">
                ${resultText}
              </td>
            </tr>
          </table>
        </div>
      </div>
    `;
    
    await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }
  
  static async createPickupChatMessage(token) {
    const content = `
      <div class="chronoball-chat-message">
        <div class="message-header">
          <span class="message-icon">👆</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.PickupTitle')}</span>
        </div>
        <div class="message-body">
          <p><strong>${token.name}</strong> picks up the ball!</p>
        </div>
      </div>
    `;
    
    await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }
  
  static async createDropChatMessage(token) {
    const content = `
      <div class="chronoball-chat-message">
        <div class="message-header">
          <span class="message-icon">⬇️</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.DropTitle')}</span>
        </div>
        <div class="message-body">
          <p><strong>${token.name}</strong> drops the ball!</p>
        </div>
      </div>
    `;
    
    await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }
  
  static async createTurnoverChatMessage(token, teamName, type) {
    const typeText = type === 'pickup' ? 'recovered' : 'intercepted';
    
    const content = `
      <div class="chronoball-chat-message turnover">
        <div class="message-header">
          <span class="message-icon">🔄</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.TurnoverTitle')}</span>
        </div>
        <div class="message-body">
          <p style="font-size: 18px; font-weight: bold; text-align: center; color: #FF9800;">
            <strong>${token.name}</strong> ${typeText} the ball!
          </p>
          <p style="text-align: center; font-size: 16px; font-weight: bold; color: #4CAF50;">
            ${teamName} takes possession!
          </p>
        </div>
      </div>
    `;
    
    await ChronoballChat.createMessage({
      content,
      speaker: { alias: 'Chronoball' }
    });
  }
}