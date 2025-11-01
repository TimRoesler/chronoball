/**
 * ChronoballPlayerPanel - Player control panel for match management
 */

import { ChronoballState } from '../scripts/state.js';
import { ChronoballRoster } from '../scripts/roster.js';
import { ChronoballBall } from '../scripts/ball.js';
import { ChronoballHUD } from './hud.js';
import { ChronoballChat } from '../scripts/chat.js';
import { ChronoballUtils } from '../scripts/utils.js';

export class ChronoballPlayerPanel extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'chronoball-player-panel',
      classes: ['chronoball-player-panel'],
      title: game.i18n.localize('CHRONOBALL.PlayerPanel.Title'),
      width: 600,
      height: 'auto',
      resizable: true,
      template: 'modules/chronoball/templates/player-panel.html'
    });
  }
  
  getData() {
    const state = ChronoballState.getMatchState();
    const rosters = ChronoballRoster.getRosterDisplayData();
    
    return {
      state,
      rosters,
      hasTeamA: rosters.teamA.length > 0,
      hasTeamB: rosters.teamB.length > 0,
      maxPlayersPerTeam: ChronoballRoster.MAX_PLAYERS_PER_TEAM // Pass the constant to the template
    };
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    html.find('.set-carrier').click(this._onSetCarrier.bind(this));
    html.find('.clear-carrier').click(this._onClearCarrier.bind(this));
    html.find('.determine-teams').click(this._onDetermineTeams.bind(this));
    html.find('.start-match').click(this._onStartMatch.bind(this));
    html.find('.end-match').click(this._onEndMatch.bind(this));
    html.find('.save-settings').click(this._onSave.bind(this));
  }
  
  async _onSetCarrier(event) {
    event.preventDefault();
    const controlled = canvas.tokens.controlled[0];
    if (!controlled) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoToken'));
      return;
    }
    await ChronoballBall.setCarrier(controlled.id);
    this.render();
  }
  
  async _onClearCarrier(event) {
    event.preventDefault();
    await ChronoballBall.clearCarrier();
    this.render();
  }
  
  async _onDetermineTeams(event) {
    event.preventDefault();

    await ChronoballRoster.determineTeamsFromEndzones();
    this.render();
  }
  
  async _onStartMatch(event) {
    event.preventDefault();

    // Ensure teams are determined
    const rosters = ChronoballRoster.getRosterDisplayData();
    if (rosters.teamA.length === 0 && rosters.teamB.length === 0) {
      ui.notifications.warn('Please determine teams first using "Determine Teams from Endzones"');
      return;
    }
    
    // Ensure combat exists FIRST (before creating ball!)
    await ChronoballState.ensureCombat();
    
    // Create or find ball token (now combat exists for state storage)
    await this._ensureBallToken();
    
    // Rebuild initiative with alternating teams
    await ChronoballRoster.rebuildInitiative(false);
    
    // Reset match state
    await ChronoballState.resetTurnDistances();
    
    ui.notifications.info('Match started! Combat tracker is ready.');
    this.render();
  }
  
  async _onEndMatch(event) {
    event.preventDefault();

    const confirm = await Dialog.confirm({
      title: game.i18n.localize('CHRONOBALL.PlayerPanel.EndMatch'),
      content: `<p>Are you sure you want to end the match? This will display the final score and clear the game.</p>`
    });
    
    if (!confirm) return;
    
    const state = ChronoballState.getMatchState();
    
    // Determine winner
    let winnerText;
    if (state.teamAScore > state.teamBScore) {
      winnerText = game.i18n.format('CHRONOBALL.Chat.MatchWinner', { team: state.teamAName });
    } else if (state.teamBScore > state.teamAScore) {
      winnerText = game.i18n.format('CHRONOBALL.Chat.MatchWinner', { team: state.teamBName });
    } else {
      winnerText = game.i18n.localize('CHRONOBALL.Chat.MatchTie');
    }
    
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
            <span style="color: var(--team-a-color, #89CFF0);">${state.teamAName}</span> ${state.teamAScore} - ${state.teamBScore} <span style="color: var(--team-b-color, #F08080);">${state.teamBName}</span>
          </p>
          <p style="text-align: center; font-size: 16px; font-weight: bold;">
            ${winnerText}
          </p>
        </div>
      </div>
    `;
    
    await ChronoballChat.createMessage({
      content,
      speaker: { alias: 'Chronoball' }
    });
    
    // Clear carrier (if exists)
    const carrier = ChronoballState.getCarrierToken();
    if (carrier) {
      await ChronoballBall.executeClearCarrier();
      ChronoballUtils.log('Chronoball | Carrier cleared during end match');
    }

    // Delete ALL Chronoball tokens on the scene
    const chronoballTokens = canvas.tokens.placeables.filter(t => t.actor?.name === 'Chronoball');
    for (const token of chronoballTokens) {
      await token.document.delete();
      ChronoballUtils.log('Chronoball | Deleted ball token:', token.id);
    }
    
    // Reset match state BEFORE deleting combat (needs combat for state storage)
    await ChronoballState.resetState();
    // End combat (this will also clear the state)
    if (game.combat) {
      await game.combat.delete();
    }
    
    ui.notifications.info('Match ended! Final score announced in chat.');
    this.close();
  }
  
  async _ensureBallToken() {
    const rules = ChronoballState.getRules();
    
    // Check if ball token already exists
    let ballToken = ChronoballState.getBallToken();

    ChronoballUtils.log('Chronoball | _ensureBallToken - Current ball token:', ballToken);
    
    if (!ballToken) {
      // Get Zone A tile to place ball in center
      const zoneATileIdOnly = rules.zoneATileId.split('.').pop();
      const zoneATile = canvas.tiles.get(zoneATileIdOnly);
      
      if (!zoneATile) {
        ui.notifications.error('Zone A not found. Cannot place ball.');
        return;
      }
      
      // Calculate center of Zone A using bounds
      const bounds = zoneATile.bounds;
      const centerX = bounds.x + (bounds.width / 2);
      const centerY = bounds.y + (bounds.height / 2);
      
      // Adjust for token size (center the token itself)
      const gridSize = canvas.grid.size;
      const tokenX = centerX - (gridSize / 2);
      const tokenY = centerY - (gridSize / 2);
      
      // Find or create ball actor robustly
      const ballActor = await ChronoballState.getOrCreateBallActor();
      
      if (!ballActor) {
        ui.notifications.error('Could not find or create the ball actor.');
        return;
      }
      
      // Create ball token on scene with custom texture
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
        disposition: 0, // Neutral
        lockRotation: true,
        displayName: 0, // NONE - Never show name
        displayBars: 0 // Never show bars
      };
      
      ChronoballUtils.log('Chronoball | Creating ball at:', { x: tokenX, y: tokenY, centerX, centerY, bounds });

      const [createdToken] = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);

      if (createdToken) {
        ChronoballUtils.log('Chronoball | Ball token created, setting state...');
        await ChronoballState.setBallToken(createdToken.id);

        // Verify it was set
        const verifyBall = ChronoballState.getBallToken();
        ChronoballUtils.log('Chronoball | Ball token verified:', verifyBall);
        
        if (!verifyBall) {
          ui.notifications.error('Ball token created but state not saved! Try restarting match.');
        } else {
          ui.notifications.info('Ball token created at Zone A center');
        }
      } else {
        ui.notifications.error('Could not create ball token.');
      }
    } else {
      // Ball exists, move it to Zone A center
      const zoneATileIdOnly = rules.zoneATileId.split('.').pop();
      const zoneATile = canvas.tiles.get(zoneATileIdOnly);
      
      if (zoneATile) {
        const bounds = zoneATile.bounds;
        const centerX = bounds.x + (bounds.width / 2);
        const centerY = bounds.y + (bounds.height / 2);
        
        const gridSize = canvas.grid.size;
        const tokenX = centerX - (gridSize / 2);
        const tokenY = centerY - (gridSize / 2);
        
        await ballToken.document.update({
          x: tokenX,
          y: tokenY
        });

        ChronoballUtils.log('Chronoball | Ball token moved to Zone A center');
      }
    }
  }

  async _onSave(event) {
    event.preventDefault();

    const html = this.element;
    const teamAName = html.find('[name="teamAName"]').val();
    const teamBName = html.find('[name="teamBName"]').val();

    await ChronoballState.updateState({
      teamAName,
      teamBName
    });

    ui.notifications.info(game.i18n.localize('CHRONOBALL.PlayerPanel.Save'));
    this.render();
  }
}