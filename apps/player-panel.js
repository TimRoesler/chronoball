/**
 * ChronoballPlayerPanel - Player control panel for match management
 */

import { ChronoballState } from '../scripts/state.js';
import { ChronoballRoster } from '../scripts/roster.js';
import { ChronoballBall } from '../scripts/ball.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ChronoballPlayerPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'chronoball-player-panel',
    classes: ['chronoball-player-panel'],
    tag: 'div',
    window: {
      title: 'CHRONOBALL.PlayerPanel.Title',
      resizable: true
    },
    position: {
      width: 600,
      height: 'auto'
    }
  };

  static PARTS = {
    content: {
      template: 'modules/chronoball/templates/player-panel.html'
    }
  };

  async _prepareContext() {
    const state = ChronoballState.getMatchState();
    const rosters = ChronoballRoster.getRosterDisplayData();
    const { ChronoballSocket } = await import('../scripts/socket.js');
    const host = ChronoballSocket.getPrimaryGM();
    return {
      state,
      rosters,
      hasTeamA: rosters.teamA.length > 0,
      hasTeamB: rosters.teamB.length > 0,
      maxPlayersPerTeam: ChronoballRoster.MAX_PLAYERS_PER_TEAM,
      hostOnline: !!host,
      hostName: host?.name ?? ''
    };
  }
  
  _onRender(context, options) {
    const root = this.element;
    if (!root) return;

    const onClick = (selector, handler) => {
      root.querySelectorAll(selector).forEach(btn => btn.addEventListener('click', handler));
    };
    
    onClick('.set-carrier', this._onSetCarrier.bind(this));
    onClick('.clear-carrier', this._onClearCarrier.bind(this));
    onClick('.determine-teams', this._onDetermineTeams.bind(this));
    onClick('.start-match', this._onStartMatch.bind(this));
    onClick('.end-match', this._onEndMatch.bind(this));
    onClick('.save-settings', this._onSave.bind(this));
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

    const { ChronoballSocket } = await import('../scripts/socket.js');
    await ChronoballSocket.executeAsGM('determineTeams', { sceneId: canvas.scene?.id });

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

    // Execute start match via GM
    const { ChronoballSocket } = await import('../scripts/socket.js');
    await ChronoballSocket.executeAsGM('startMatch', { sceneId: canvas.scene?.id });

    this.render();
  }
  
  async _onEndMatch(event) {
    event.preventDefault();

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('CHRONOBALL.PlayerPanel.EndMatch') },
      content: '<p>Are you sure you want to end the match? This will display the final score and clear the game.</p>',
      rejectClose: false
    });

    if (!confirmed) return;

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

    // Execute end match via GM
    const { ChronoballSocket } = await import('../scripts/socket.js');
    await ChronoballSocket.executeAsGM('endMatch', {
      scoreAName: state.teamAName,
      scoreBName: state.teamBName,
      scoreA: state.teamAScore,
      scoreB: state.teamBScore,
      winnerText
    });

    this.close();
  }
  
  async _onSave(event) {
    event.preventDefault();

    const root = this.element;
    if (!root) return;
    const teamAName = root.querySelector('[name="teamAName"]')?.value ?? '';
    const teamBName = root.querySelector('[name="teamBName"]')?.value ?? '';

    const { ChronoballSocket } = await import('../scripts/socket.js');
    await ChronoballSocket.executeAsGM('updateMatchState', { updates: { teamAName, teamBName } });

    ui.notifications.info(game.i18n.localize('CHRONOBALL.PlayerPanel.Save'));
  }
}
