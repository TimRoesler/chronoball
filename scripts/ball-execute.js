/**
 * ChronoballBallExecute - GM-side execution of ball actions, animations, chat messages, and match lifecycle
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils, ANIMATION_DURATION_MS, SCORE_DELAY_MS } from './utils.js';
import { ChronoballScoring } from './scoring.js';
import { ChronoballCarrier } from './carrier.js';
import { ChronoballRolls } from './rolls.js';

export class ChronoballBallExecute {

  // === Authoritative execution methods (called by socket) ===

  static async executeThrow(tokenId, targetX, targetY, skill, distance, dc, rollTotal, success, modification) {
    const token = ChronoballState.getMatchTokenDoc(tokenId);
    if (!token) return;

    const rules = ChronoballState.getRules();

    // Get or create ball token at carrier position
    let ballToken = ChronoballState.getBallTokenDoc();

    // If ball doesn't exist (was deleted when picked up), create it temporarily at carrier
    if (!ballToken) {
      await this.recreateBallToken(token.x, token.y);
      ballToken = ChronoballState.getBallTokenDoc();
    }

    if (!ballToken) {
      console.error('Chronoball | Could not create ball token for throw');
      return;
    }

    // Adjust for token center
    const gridSize = ChronoballUtils.getMatchGrid().size;
    const adjustedX = targetX - (gridSize / 2);
    const adjustedY = targetY - (gridSize / 2);

    if (success) {
      // Throw was successful - ball reaches target
      ChronoballUtils.log(`Chronoball | Successful throw: ${distance}ft to (${adjustedX}, ${adjustedY})`);

      // IMPORTANT: Clear carrier FIRST, before animation, to ensure effects are removed
      await ChronoballCarrier.executeClearCarrier();

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
          .duration(ANIMATION_DURATION_MS)
          .waitUntilFinished(-1);

        try {
          await sequence.play();
        } catch (e) {
          ChronoballUtils.log('Chronoball | Sequencer play failed (host viewing another scene?), continuing:', e);
        }
        ChronoballUtils.log('Chronoball | Sequencer animation completed');

        await ballToken.update({ x: adjustedX, y: adjustedY }, { chronoball_internal: true });
        ChronoballUtils.log('Chronoball | Ball position updated to target');
      } else {
        // Fallback: Move ball instantly if Sequencer not available
        ChronoballUtils.log('Chronoball | Sequencer not active, moving ball instantly');
        if (ballToken) {
          await ballToken.update({ x: adjustedX, y: adjustedY }, { chronoball_internal: true });
        }
      }

      // Let the ball sit at the target for a moment (500ms) before scoring
      ChronoballUtils.log('Chronoball | Ball at target, waiting 500ms before scoring check...');
      await new Promise(resolve => setTimeout(resolve, SCORE_DELAY_MS));

      // Clear the flag BEFORE scoring check
      await ChronoballState.updateState({ throwInProgress: false });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to FALSE');

      // Check for scoring (ball landed in endzone) AFTER animation and delay
      const scored = await ChronoballScoring.checkThrowScore(ballToken, adjustedX, adjustedY);

      // Create chat message
      await this.createThrowChatMessage(token, distance, distance, dc, rollTotal, true, scored, modification);

      if (scored) {
        const state = ChronoballState.getMatchState();
        const teamName = state.attackingTeam === 'A' ? state.teamAName : state.teamBName;
        const points = rules.scoreThrow || 1;
        ui.notifications.notify(game.i18n.format('CHRONOBALL.Notifications.ScorePoints', { team: teamName, points }));
      } else {
        ui.notifications.info(game.i18n.format('CHRONOBALL.Notifications.BallThrownSuccess', { distance: Math.round(distance) }));
      }

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
      await ChronoballCarrier.executeClearCarrier();

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
          .duration(ANIMATION_DURATION_MS)
          .waitUntilFinished(-1);

        try {
          await sequence.play();
        } catch (e) {
          ChronoballUtils.log('Chronoball | Sequencer play failed (host viewing another scene?), continuing:', e);
        }
        ChronoballUtils.log('Chronoball | Sequencer animation completed');

        await ballToken.update({ x: actualX, y: actualY }, { chronoball_internal: true });
      } else {
        // Fallback: Move ball instantly
        if (ballToken) {
          await ballToken.update({ x: actualX, y: actualY }, { chronoball_internal: true });
        }
      }

      // Let the ball sit for a moment before scoring check
      await new Promise(resolve => setTimeout(resolve, SCORE_DELAY_MS));

      // Clear the flag BEFORE scoring check
      await ChronoballState.updateState({ throwInProgress: false });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to FALSE');

      // Check for scoring even on failed throw (might still land in endzone)
      const scored = await ChronoballScoring.checkThrowScore(ballToken, actualX, actualY);

      // Create chat message
      await this.createThrowChatMessage(token, distance, achievedDistance, dc, rollTotal, false, scored, modification);

      if (scored) {
        const state = ChronoballState.getMatchState();
        const teamName = state.attackingTeam === 'A' ? state.teamAName : state.teamBName;
        const points = rules.scoreThrow || 1;
        ui.notifications.notify(game.i18n.format('CHRONOBALL.Notifications.ScorePoints', { team: teamName, points }));
      } else {
        ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.ThrowFellShort', { achieved: Math.round(achievedDistance), distance: Math.round(distance) }));
      }
    }
  }

  static async executePass(tokenId, targetTokenId, skill, distance, dc, rollTotal, success, modification) {
    const token = ChronoballState.getMatchTokenDoc(tokenId);
    const targetToken = ChronoballState.getMatchTokenDoc(targetTokenId);
    if (!token || !targetToken) return;

    const rules = ChronoballState.getRules();

    // Get or create ball token at carrier position
    let ballToken = ChronoballState.getBallTokenDoc();

    // If ball doesn't exist (was deleted when picked up), create it temporarily at carrier
    if (!ballToken) {
      await this.recreateBallToken(token.x, token.y);
      ballToken = ChronoballState.getBallTokenDoc();
    }

    if (success) {
      // Pass was successful - animate ball to receiver
      const targetX = targetToken.x;
      const targetY = targetToken.y;

      // Deduct from remaining throw distance
      await ChronoballState.deductThrowDistance(distance);

      // Set flag to prevent updateToken hook from triggering scoring during animation
      await ChronoballState.updateState({ throwInProgress: true });

      // Animate ball flying with Sequencer
      if (game.modules.get('sequencer')?.active && ballToken) {
        const sequence = new Sequence()
          .animation()
          .on(ballToken)
          .moveTowards({ x: targetX, y: targetY }, { ease: "easeOutCubic" })
          .duration(ANIMATION_DURATION_MS) // 1.5 seconds
          .waitUntilFinished();

        try {
          await sequence.play();
        } catch (e) {
          ChronoballUtils.log('Chronoball | Sequencer play failed (host viewing another scene?), continuing:', e);
        }

        // Update final position
        await ballToken.update({ x: targetX, y: targetY }, { chronoball_internal: true });
      } else {
        // Fallback: Move token instantly
        if (ballToken) {
          await ballToken.update({ x: targetX, y: targetY }, { chronoball_internal: true });
        }
      }

      // Clear the flag BEFORE interception check
      await ChronoballState.updateState({ throwInProgress: false });

      // AFTER animation, check for interception at receiver (lazy import to avoid circular dependency)
      const { ChronoballInterception } = await import('./interception.js');
      const interceptedAtReceiver = await ChronoballInterception.checkInterceptionAtReceiver(targetToken, token);

      if (interceptedAtReceiver) {
        // Ball was intercepted at receiver after animation - interception.js handles the turnover
        // Create chat message for successful pass but intercepted
        await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, true, null, true, false, false, modification);
        return; // Exit - interception handled in interception.js (endPhase will delete ball)
      }

      // No interception - receiver gets ball normally
      // Delete ball token and set receiver as carrier
      if (ballToken) {
        await ballToken.delete();
        await ChronoballState.updateState({ ballTokenId: null });
      }

      // Clear old carrier and set new carrier
      await ChronoballCarrier.executeClearCarrier();
      await ChronoballSocket.executeAsGM('setCarrier', { tokenId: targetTokenId });

      // Check if receiver is in target endzone (for pass-in-zone score)
      const state = ChronoballState.getMatchState();
      const targetZoneId = state.attackingTeam === 'A' ? rules.zoneBRegionId : rules.zoneARegionId;
      const receiverInEndzone = ChronoballState.isTokenCenterInRegion(targetToken, targetToken.x, targetToken.y, targetZoneId);

      // If receiver caught in endzone, award pass-in-zone score
      if (receiverInEndzone) {
        await ChronoballScoring.awardPassInZoneScore(state.attackingTeam);
        await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, true, null, false, true, true, modification);
        return; // Return early as scoring handles phase end
      }

      // Normal pass completion
      await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, true, null, false, false, false, modification);

      ui.notifications.info(game.i18n.localize('CHRONOBALL.Chat.PassTitle'));

    } else {
      // Failed pass - ball falls short
      const achievedDistance = this.calculateAchievedDistance(rollTotal, distance, rules);

      // Calculate position along the path
      const ratio = distance > 0 ? achievedDistance / distance : 0;
      const actualX = token.x + (targetToken.x - token.x) * ratio;
      const actualY = token.y + (targetToken.y - token.y) * ratio;

      ChronoballUtils.log(`Chronoball | Failed pass: Intended ${distance}ft, achieved ${achievedDistance}ft (${Math.round(ratio * 100)}%)`);

      // Clear carrier FIRST, before animation (consistent with failed throw)
      await ChronoballCarrier.executeClearCarrier();

      // Set flag to prevent updateToken hook from triggering scoring during animation
      await ChronoballState.updateState({ throwInProgress: true });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to TRUE (failed pass)');

      // Deduct only the actual distance
      await ChronoballState.deductThrowDistance(achievedDistance);

      // Animate ball flying with Sequencer to partial distance
      if (game.modules.get('sequencer')?.active && ballToken) {
        const sequence = new Sequence()
          .animation()
          .on(ballToken)
          .moveTowards({ x: actualX, y: actualY }, { ease: "easeOutCubic" })
          .duration(ANIMATION_DURATION_MS)
          .waitUntilFinished();

        try {
          await sequence.play();
        } catch (e) {
          ChronoballUtils.log('Chronoball | Sequencer play failed (host viewing another scene?), continuing:', e);
        }

        await ballToken.update({ x: actualX, y: actualY }, { chronoball_internal: true });
      } else {
        if (ballToken) {
          await ballToken.update({ x: actualX, y: actualY }, { chronoball_internal: true });
        } else {
          await this.recreateBallToken(actualX, actualY);
        }
      }

      // Let the ball sit for a moment before scoring check
      await new Promise(resolve => setTimeout(resolve, SCORE_DELAY_MS));

      // Clear the flag BEFORE scoring check
      await ChronoballState.updateState({ throwInProgress: false });
      ChronoballUtils.log('Chronoball | throwInProgress flag set to FALSE (failed pass)');

      // Check for scoring even on failed pass (might still land in endzone)
      const scored = await ChronoballScoring.checkThrowScore(ballToken ?? null, actualX, actualY);

      // Create chat message
      await this.createPassChatMessage(token, targetToken, distance, dc, rollTotal, false, achievedDistance, false, false, false, modification);

      if (scored) {
        const state = ChronoballState.getMatchState();
        const teamName = state.attackingTeam === 'A' ? state.teamAName : state.teamBName;
        const points = rules.scoreThrow || 1;
        ui.notifications.notify(game.i18n.format('CHRONOBALL.Notifications.ScoreDeflectedPass', { team: teamName, points }));
      } else {
        ui.notifications.warn(game.i18n.format('CHRONOBALL.Notifications.PassFellShort', { achieved: Math.round(achievedDistance), distance: Math.round(distance) }));
      }
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
    const token = ChronoballState.getMatchTokenDoc(tokenId);
    if (!token) return;

    // Ensure this runs as authorized executor (GM/Host, or owner if no GM online)
    if (!ChronoballSocket.isAuthorizedExecutor(token)) {
      console.error('Chronoball | executePickup called by unauthorized user!');
      return;
    }

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

      ui.notifications.notify(game.i18n.format('CHRONOBALL.Notifications.RecoveredTurnover', { team: teamName }));

    } else {
      // Attacker picked up ball normally
      // Set as carrier
      await ChronoballCarrier.executeSetCarrier(tokenId);

      // Delete the ball token (carrier has the ball now)
      const ballToken = ChronoballState.getBallTokenDoc();
      if (ballToken) {
        await ballToken.delete();
        // Clear the ball token ID from state (will be recreated when thrown/dropped)
        await ChronoballState.updateState({ ballTokenId: null });
      }

      // Create chat message
      await this.createPickupChatMessage(token);

      ui.notifications.info(game.i18n.localize('CHRONOBALL.Chat.PickupTitle'));
    }
  }

  static async executeDrop(tokenId, dropX, dropY) {
    const token = ChronoballState.getMatchTokenDoc(tokenId);
    if (!token) return;

    // Ensure this runs as authorized executor (GM/Host, or owner if no GM online)
    if (!ChronoballSocket.isAuthorizedExecutor(token)) {
      console.error('Chronoball | executeDrop called by unauthorized user!');
      return;
    }

    let ballX = token.x;
    let ballY = token.y;

    if (dropX !== undefined && dropY !== undefined) {
      // The ball is always 1x1 grid units, so its dimensions are the grid size.
      const ballPixelWidth = ChronoballUtils.getMatchGrid().size;
      const ballPixelHeight = ballPixelWidth;

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
    await ChronoballCarrier.executeClearCarrier();

    // Create chat message
    await this.createDropChatMessage(token);

    ui.notifications.info(game.i18n.localize('CHRONOBALL.Chat.DropTitle'));
  }

  static async executeFumble(tokenId) {
    const token = ChronoballState.getMatchTokenDoc(tokenId);
    if (!token) return;

    // Ensure this runs as authorized executor (GM/Host, or owner if no GM online)
    if (!ChronoballSocket.isAuthorizedExecutor(token)) {
      console.error('Chronoball | executeFumble called by unauthorized user!');
      return;
    }

    // --- Scatterball Logic ---
    const scatterRadiusFeet = 5;
    const grid = ChronoballUtils.getMatchGrid();
    const gridSize = grid.size;
    const gridDistance = grid.distance;
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
    await ChronoballCarrier.executeClearCarrier();

    // Create a chat message for the fumble
    const content = `
      <div class="chronoball-chat-message failure">
        <div class="message-header">
          <span class="message-icon">💥</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.Fumble')}</span>
        </div>
        <div class="message-body">
          <p>${game.i18n.format('CHRONOBALL.Chat.FumbleDropped', { name: `<strong>${token.name}</strong>` })}</p>
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
    const tokenData = ChronoballUtils.applyTokenHudDefaults({
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
      lockRotation: true
    });

    const createdTokens = await ChronoballUtils.getMatchScene().createEmbeddedDocuments('Token', [tokenData]);

    if (createdTokens && createdTokens.length > 0) {
      await ChronoballState.setBallToken(createdTokens[0].id);
      ChronoballUtils.log('Chronoball | Ball token recreated at:', x, y);
    }
  }

  // === Match Lifecycle (moved from socket.js) ===

  /**
   * Ensure ball token exists on the scene, creating or repositioning as needed.
   */
  static async ensureBallToken() {
    const rules = ChronoballState.getRules();
    const state = ChronoballState.getMatchState();

    // Determine zone based on attacking team (not hardcoded to Zone A)
    const attackingZoneId = state.attackingTeam === 'A' ? rules.zoneARegionId : rules.zoneBRegionId;
    if (!attackingZoneId) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.ZoneANotFound'));
      return;
    }

    const matchScene = ChronoballUtils.getMatchScene();
    const zoneRegion = ChronoballState.getZoneRegion(attackingZoneId, matchScene);
    if (!zoneRegion) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.ZoneANotFound'));
      return;
    }

    // Calculate center of zone from the region bounds
    const bounds = zoneRegion.bounds;
    const centerX = bounds.x + (bounds.width / 2);
    const centerY = bounds.y + (bounds.height / 2);
    const gridSize = matchScene.grid.size;
    const tokenX = centerX - (gridSize / 2);
    const tokenY = centerY - (gridSize / 2);

    // Check if ball token already exists
    let ballToken = ChronoballState.getBallTokenDoc();

    if (!ballToken) {
      const ballActor = await ChronoballState.getOrCreateBallActor();
      if (!ballActor) {
        ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.CouldNotCreateBallActor'));
        return;
      }

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
        await ChronoballState.setBallToken(createdToken.id);
        ui.notifications.info(game.i18n.localize('CHRONOBALL.Notifications.BallTokenCreated'));
      } else {
        ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.CouldNotCreateBallToken'));
      }
    } else {
      // Ball exists, move it to attacking team's zone center
      await ballToken.update({ x: tokenX, y: tokenY });
    }
  }

  /**
   * End the match: announce score, clean up tokens, reset state.
   */
  static async executeEndMatch(data) {
    try {
      ChronoballUtils.log(`Chronoball | GM executing end match`);

      const { scoreAName, scoreBName, scoreA, scoreB, winnerText } = data;

      // Create end match chat message
      const content = `
        <div class="chronoball-chat-message match-end">
          <div class="message-header">
            <span class="message-icon">🏆</span>
            <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.MatchEndTitle')}</span>
          </div>
          <div class="message-body">
            <h2 style="text-align: center; margin: 10px 0; font-size: 20px;">
              ${game.i18n.localize('CHRONOBALL.Chat.FinalScore')}
            </h2>
            <p style="text-align: center; font-size: 24px;">
              <span style="color: var(--team-a-color, #89CFF0);">${foundry.utils.escapeHTML(scoreAName)}</span> ${scoreA} - ${scoreB} <span style="color: var(--team-b-color, #F08080);">${foundry.utils.escapeHTML(scoreBName)}</span>
            </p>
            <p style="text-align: center; font-size: 16px; font-weight: bold;">
              ${foundry.utils.escapeHTML(winnerText)}
            </p>
          </div>
        </div>
      `;

      await ChronoballChat.createMessage({
        content,
        speaker: { alias: 'Chronoball' }
      });

      // Clear carrier (if exists)
      const carrier = ChronoballState.getCarrierTokenDoc();
      if (carrier) {
        await ChronoballCarrier.executeClearCarrier();
      }

      // Delete ALL Chronoball tokens on the match scene
      const matchScene = ChronoballUtils.getMatchScene();
      const chronoballTokens = matchScene
        ? matchScene.tokens.filter(td => td.actor?.name === 'Chronoball')
        : [];
      for (const tokenDoc of chronoballTokens) {
        await tokenDoc.delete();
      }

      // Clear match active flag on Ball Actor
      const ballActor = ChronoballState.getBallActor();
      if (ballActor) {
        await ballActor.unsetFlag('chronoball', 'matchActiveSceneId');
      }

      // Reset match state
      await ChronoballState.resetState();

      ui.notifications.info(game.i18n.localize('CHRONOBALL.Notifications.MatchEnded'));
      const { ChronoballSocket } = await import('./socket.js');
      ChronoballSocket.broadcastActionComplete('endMatch');
      ChronoballUtils.log(`Chronoball | End match completed successfully`);
    } catch (e) {
      console.error('Chronoball | Failed to execute end match via GM:', e);
      ui.notifications.error('Failed to end match. Check console for details.');
    }
  }

  // === Chat message helpers ===

  static async createThrowChatMessage(token, targetDistance, actualDistance, dc, rollTotal, success, scored, modification) {
    const resultIcon = success ? '✅' : '❌';
    const resultText = success ? game.i18n.localize('CHRONOBALL.Chat.Success') : game.i18n.localize('CHRONOBALL.Chat.Failure');
    const distanceText = success
      ? game.i18n.format('CHRONOBALL.Chat.ThrowNarrative', { name: `<strong>${token.name}</strong>`, distance: Math.round(actualDistance) })
      : game.i18n.format('CHRONOBALL.Chat.ThrowNarrativeFail', { name: `<strong>${token.name}</strong>`, target: Math.round(targetDistance), achieved: Math.round(actualDistance) });
    const modHint = ChronoballRolls.buildModificationHint(modification);

    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🎯</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.ThrowTitle')}</span>
        </div>
        <div class="message-body">
          <p>${distanceText}</p>
          <p>${game.i18n.localize('CHRONOBALL.Chat.DC')} ${dc} | ${game.i18n.localize('CHRONOBALL.Chat.Roll')}: <strong>${rollTotal}</strong> | <span class="message-result ${success ? 'success' : 'failure'}">${resultIcon} ${resultText}</span></p>
          ${modHint}
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }

  static async createPassChatMessage(token, targetToken, targetDistance, dc, rollTotal, success, actualDistance, intercepted, passInZone, scored, modification) {
    actualDistance = actualDistance || null;
    intercepted = intercepted || false;

    let resultIcon, resultText;
    if (intercepted) {
      resultIcon = '⚠️';
      resultText = game.i18n.localize('CHRONOBALL.Chat.PassIntercepted');
    } else if (success) {
      resultIcon = '✅';
      resultText = game.i18n.localize('CHRONOBALL.Chat.Success');
    } else {
      resultIcon = '❌';
      resultText = game.i18n.localize('CHRONOBALL.Chat.Failure');
    }

    let narrativeText;
    if (intercepted) {
      narrativeText = `<strong>${token.name}</strong> → <strong>${targetToken.name}</strong>`;
    } else if (success) {
      narrativeText = `<strong>${token.name}</strong> → <strong>${targetToken.name}</strong> — ${Math.round(targetDistance)} ft`;
    } else {
      narrativeText = game.i18n.format('CHRONOBALL.Chat.PassNarrativeFail', { name: `<strong>${token.name}</strong>`, receiver: `<strong>${targetToken.name}</strong>`, target: Math.round(targetDistance), achieved: Math.round(actualDistance) });
    }

    const modHint = ChronoballRolls.buildModificationHint(modification);

    const resultClass = intercepted ? 'intercepted' : (success ? 'success' : 'failure');

    const content = `
      <div class="chronoball-chat-message ${success ? 'success' : 'failure'}">
        <div class="message-header">
          <span class="message-icon">🤝</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.PassTitle')}</span>
        </div>
        <div class="message-body">
          <p>${narrativeText}</p>
          <p>${game.i18n.localize('CHRONOBALL.Chat.DC')} ${dc} | ${game.i18n.localize('CHRONOBALL.Chat.Roll')}: <strong>${rollTotal}</strong> | <span class="message-result ${resultClass}">${resultIcon} ${resultText}</span></p>
          ${modHint}
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }

  static async createPickupChatMessage(token) {
    const content = `
      <div class="chronoball-chat-message">
        <div class="message-header">
          <span class="message-icon">👆</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.PickupTitle')}</span>
        </div>
        <div class="message-body">
          <p>${game.i18n.format('CHRONOBALL.Chat.PicksUpBall', { name: `<strong>${token.name}</strong>` })}</p>
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }

  static async createDropChatMessage(token) {
    const content = `
      <div class="chronoball-chat-message">
        <div class="message-header">
          <span class="message-icon">⬇️</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.DropTitle')}</span>
        </div>
        <div class="message-body">
          <p>${game.i18n.format('CHRONOBALL.Chat.DropsBall', { name: `<strong>${token.name}</strong>` })}</p>
        </div>
      </div>
    `;

    await ChronoballChat.createMessage({ content, speaker: ChatMessage.getSpeaker({ token }) });
  }

  static async createTurnoverChatMessage(token, teamName, type) {
    const typeText = type === 'pickup'
      ? game.i18n.format('CHRONOBALL.Chat.TurnoverRecovered', { name: `<strong>${token.name}</strong>` })
      : game.i18n.format('CHRONOBALL.Chat.TurnoverIntercepted', { name: `<strong>${token.name}</strong>` });

    const content = `
      <div class="chronoball-chat-message turnover">
        <div class="message-header">
          <span class="message-icon">🔄</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.TurnoverTitle')}</span>
        </div>
        <div class="message-body">
          <p style="font-size: 18px; font-weight: bold; text-align: center; color: #FF9800;">
            ${typeText}
          </p>
          <p style="text-align: center; font-size: 16px; font-weight: bold; color: #4CAF50;">
            ${game.i18n.format('CHRONOBALL.Chat.TakesPossession', { team: teamName })}
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
