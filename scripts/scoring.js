/**
 * ChronoballScoring - Handles scoring mechanics
 */

import { ChronoballState } from './state.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils } from './utils.js';

export class ChronoballScoring {
  static SCORE_DEBOUNCE_TIME = 1000; // 1 second
  static lastScoreCheck = 0;
  
  static initialize() {
    ChronoballUtils.log('Chronoball | Scoring system initialized');
  }
  
  static setupSceneHooks() {
    // Setup is done via main hooks
  }
  
  // The checkTokenPosition function has been removed and its logic moved directly into the updateToken hook for clarity and accuracy.
  
  /**
   * Check for run-in score (carrier enters endzone)
   */
  static async checkRunInScore(tokenDoc, x, y) {
    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();

    if (!rules.zoneATileId || !rules.zoneBTileId) {
      return; // Endzones not configured
    }

    // Debounce to prevent multiple scores from a single movement
    const now = Date.now();
    if (now - state.lastScoreTimestamp < this.SCORE_DEBOUNCE_TIME) {
      return;
    }

    // Wait for visual animation to complete (similar to throw-in)
    ChronoballUtils.log('Chronoball | Carrier moved, waiting 1000ms for visual animation...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Re-fetch current position after delay to ensure we check the final position
    const currentToken = canvas.tokens.get(tokenDoc.id);
    if (!currentToken) return;

    // Check if still the carrier (could have changed during delay)
    const currentState = ChronoballState.getMatchState();
    if (currentState.carrierId !== tokenDoc.id) {
      ChronoballUtils.log('Chronoball | Token is no longer carrier after delay, skipping scoring');
      return;
    }

    // Determine which endzone to check based on attacking team
    const targetZoneId = currentState.attackingTeam === 'A' ? rules.zoneBTileId : rules.zoneATileId;

    // Check if carrier's center is in the target endzone using current position
    const inEndzone = ChronoballState.isTokenCenterInTile(currentToken.document, currentToken.x, currentToken.y, targetZoneId);

    if (inEndzone) {
      const carrierTeam = ChronoballState.getTeamAssignment(tokenDoc.actorId);
      ChronoballUtils.log(`Chronoball | ${tokenDoc.name} (Team ${carrierTeam}) scored in target zone!`);
      await this.awardRunInScore(currentState.attackingTeam);
    }
  }
  
  /**
   * Check for throw score (ball lands in endzone without carrier)
   */
  static async checkThrowScore(ballTokenDoc, x, y) {
    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();

    if (!rules.zoneATileId || !rules.zoneBTileId) {
      return;
    }
    
    // Debounce to prevent multiple scores
    const now = Date.now();
    if (now - state.lastScoreTimestamp < this.SCORE_DEBOUNCE_TIME) {
      return;
    }

    // Determine which endzone to check based on attacking team
    const targetZoneId = state.attackingTeam === 'A' ? rules.zoneBTileId : rules.zoneATileId;

    // Check if ball's center is in target endzone
    const inEndzone = ChronoballState.isTokenCenterInTile(ballTokenDoc, x, y, targetZoneId);

    if (inEndzone) {
      await this.awardThrowScore(state.attackingTeam);
    }
  }
  
  /**
   * Award run-in score (configurable points)
   */
  static async awardRunInScore(team) {
    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();
    const points = rules.scoreRunIn || 2;
    
    // Update timestamp to prevent duplicate scoring
    await ChronoballState.updateState({
      lastScoreTimestamp: Date.now()
    });
    
    // Add points
    const scoreKey = team === 'A' ? 'teamAScore' : 'teamBScore';
    const newScore = state[scoreKey] + points;
    
    await ChronoballState.updateState({
      [scoreKey]: newScore
    });
    
    // Create chat message
    const teamName = team === 'A' ? state.teamAName : state.teamBName;
    await this.createScoreChatMessage(teamName, points, 'run-in');
    
    // Clear carrier before ending phase (carrier exists in run-in)
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeClearCarrier();
    
    // End phase (will spawn ball in new attacking zone)
    await ChronoballState.endPhase();
    
    ui.notifications.notify(`${teamName} scores ${points} points!`);
  }
  
  /**
   * Award throw score (configurable points)
   */
  static async awardThrowScore(team) {
    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();
    const points = rules.scoreThrow || 1;
    
    // Update timestamp to prevent duplicate scoring
    await ChronoballState.updateState({
      lastScoreTimestamp: Date.now()
    });
    
    // Add points
    const scoreKey = team === 'A' ? 'teamAScore' : 'teamBScore';
    const newScore = state[scoreKey] + points;
    
    await ChronoballState.updateState({
      [scoreKey]: newScore
    });
    
    // Create chat message
    const teamName = team === 'A' ? state.teamAName : state.teamBName;
    await this.createScoreChatMessage(teamName, points, 'throw');
    
    // No carrier to clear (ball was thrown)
    // But we still need to clean up state
    await ChronoballState.updateState({ carrierId: null });
    
    // End phase (will spawn ball in new attacking zone)
    await ChronoballState.endPhase();
    
    ui.notifications.notify(`${teamName} scores ${points} point(s)!`);
  }
  
  /**
   * Award pass-in-zone score (configurable points)
   */
  static async awardPassInZoneScore(team) {
    const state = ChronoballState.getMatchState();
    const rules = ChronoballState.getRules();
    const points = rules.scorePassInZone || 2;
    
    // Update timestamp to prevent duplicate scoring
    await ChronoballState.updateState({
      lastScoreTimestamp: Date.now()
    });
    
    // Add points
    const scoreKey = team === 'A' ? 'teamAScore' : 'teamBScore';
    const newScore = state[scoreKey] + points;
    
    await ChronoballState.updateState({
      [scoreKey]: newScore
    });
    
    // Create chat message
    const teamName = team === 'A' ? state.teamAName : state.teamBName;
    await this.createScoreChatMessage(teamName, points, 'pass-in-zone');
    
    // Clear carrier before ending phase (receiver is carrier)
    const ChronoballBall = (await import('./ball.js')).ChronoballBall;
    await ChronoballBall.executeClearCarrier();
    
    // End phase (will spawn ball in new attacking zone)
    await ChronoballState.endPhase();
    
    ui.notifications.notify(`${teamName} scores ${points} points with a pass in the endzone!`);
  }
  
  // isTokenInTile has been moved to state.js as isTokenCenterInTile and isTokenFullyInTile
  
  /**
   * Create scoring chat message
   */
  static async createScoreChatMessage(teamName, points, type) {
    let messageKey;
    
    if (type === 'run-in') {
      messageKey = 'CHRONOBALL.Chat.RunInScore';
    } else if (type === 'throw') {
      messageKey = 'CHRONOBALL.Chat.ThrowScore';
    } else if (type === 'pass-in-zone') {
      messageKey = 'CHRONOBALL.Chat.PassInZoneScore';
    }
    
    const message = game.i18n.format(messageKey, { team: teamName });
    
    const content = `
      <div class="chronoball-chat-message score">
        <div class="message-header">
          <span class="message-icon">🏆</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.ScoreTitle')}</span>
        </div>
        <div class="message-body">
          <p style="font-size: 18px; font-weight: bold; text-align: center;">
            ${message}
          </p>
          <p style="text-align: center; font-size: 24px;">
            +${points} ${game.i18n.localize('CHRONOBALL.HUD.Score')}
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