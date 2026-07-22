/**
 * ChronoballHUD - Persistent HUD overlay
 */

import { ChronoballState } from '../scripts/state.js';
import { ChronoballUtils } from '../scripts/utils.js';
import { ChronoballSocket } from '../scripts/socket.js';

export class ChronoballHUD {
  static element = null;
  static isMounted = false;
  
  static initialize() {
    ChronoballUtils.log('Chronoball | HUD initialized');
    
    // Event delegation on the document for the Finish Turn button click
    document.addEventListener('click', async (event) => {
      const btn = event.target.closest('.chronoball-finish-turn-btn');
      if (btn) {
        event.preventDefault();
        const { ChronoballSocket } = await import('../scripts/socket.js');
        await ChronoballSocket.executeAsGM('finishTurn');
      }
    });

    Hooks.on('chronoball.stateChanged', () => {
      this.mount();
      this.render();
      this.updateVisibility();
    });

    Hooks.on('canvasReady', () => {
      this.mount();
      this.render();
      this.updateVisibility();
    });
  }
  
  /**
   * Mount HUD to DOM
   */
  static mount() {
    const existing = document.getElementById('chronoball-hud');
    if (existing) {
      this.element = existing;
      this.isMounted = true;
      return;
    }
    
    this.element = document.createElement('div');
    this.element.id = 'chronoball-hud';
    this.element.className = 'chronoball-hud';
    
    document.body.appendChild(this.element);
    
    this.isMounted = true;
    this.render();
    this.updateVisibility();
    
    ChronoballUtils.log('Chronoball | HUD mounted');
  }
  
  /**
   * Update HUD visibility based on state
   */
  static updateVisibility() {
    if (!this.element) return;

    if (ChronoballState.isMatchActiveOnCurrentScene()) {
      this.element.classList.add('visible');
    } else {
      this.element.classList.remove('visible');
    }
  }
  
  /**
   * Render HUD content
   */
  static render() {
    this.mount();
    if (!this.element) return;
    
    const state = ChronoballState.getMatchState();
    const carrier = ChronoballState.getCarrierToken();
    const rules = ChronoballState.getRules();
    
    // Calculate max distances for progress bars
    const limits = ChronoballState.getMovementLimits();
    const maxMove = limits.move;
    const maxThrow = limits.throw;
    
    const movePercent = maxMove > 0 ? (state.remainingMove / maxMove) * 100 : 0;
    const throwPercent = maxThrow > 0 ? (state.remainingThrow / maxThrow) * 100 : 0;
    
    // Team colors: Team A = Blue, Team B = Red (always)
    const teamAColor = '#2196F3';
    const teamBColor = '#f44336';
    
    // Get attacking and defending team names with their respective colors
    const attackingTeamName = state.attackingTeam === 'A' ? state.teamAName : state.teamBName;
    const defendingTeamName = state.defendingTeam === 'A' ? state.teamAName : state.teamBName;
    const attackingTeamColor = state.attackingTeam === 'A' ? teamAColor : teamBColor;
    const defendingTeamColor = state.defendingTeam === 'A' ? teamAColor : teamBColor;
    
    // Build movement rows HTML - only show if > 0
    let movementRowsHTML = '';
    
    if (maxMove > 0) {
      movementRowsHTML += `
        <div class="hud-row remaining-move">
          <span class="hud-label">${game.i18n.localize('CHRONOBALL.HUD.RemainingMove')}:</span>
          <div class="remaining-bar">
            <div class="remaining-fill" style="width: ${movePercent}%"></div>
          </div>
          <span class="remaining-text">${state.remainingMove.toFixed(1)} ${game.i18n.localize('CHRONOBALL.HUD.Feet')}</span>
        </div>
      `;
    }
    
    if (maxThrow > 0) {
      movementRowsHTML += `
        <div class="hud-row remaining-throw">
          <span class="hud-label">${game.i18n.localize('CHRONOBALL.HUD.RemainingThrow')}:</span>
          <div class="remaining-bar">
            <div class="remaining-fill" style="width: ${throwPercent}%"></div>
          </div>
          <span class="remaining-text">${state.remainingThrow.toFixed(1)} ${game.i18n.localize('CHRONOBALL.HUD.Feet')}</span>
        </div>
      `;
    }
    
    // Get active token
    const activeTokenId = state.turnOrder && state.currentTurnIndex !== undefined && state.currentTurnIndex >= 0
      ? state.turnOrder[state.currentTurnIndex]
      : null;
    const activeToken = activeTokenId ? ChronoballUtils.getMatchScene()?.tokens.get(activeTokenId) : null;

    let finishTurnHTML = '';
    if (activeToken) {
      const isOwner = activeToken.isOwner;
      const isHost = ChronoballSocket.isPrimaryGM();
      const canEndTurn = isOwner || isHost;
      if (canEndTurn) {
        finishTurnHTML = `
          <div class="hud-footer" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 8px; text-align: center;">
            <button type="button" class="chronoball-finish-turn-btn pill-highlight" style="width: 100%; padding: 6px 12px; font-weight: bold; cursor: pointer; border: none; border-radius: 4px; background: var(--chronoball-primary, #FF9800); color: white;">
              ${game.i18n.localize('CHRONOBALL.HUD.FinishTurn') || 'Finish Turn'}
            </button>
          </div>
        `;
      }
    }

    const html = `
      <div class="hud-header">
        <div class="team-info">
          <div class="team-name" style="color: ${teamAColor}; font-weight: bold;">${foundry.utils.escapeHTML(state.teamAName)}</div>
          <div class="team-score">${state.teamAScore}</div>
        </div>
        <div class="vs-separator">VS</div>
        <div class="team-info">
          <div class="team-name" style="color: ${teamBColor}; font-weight: bold;">${foundry.utils.escapeHTML(state.teamBName)}</div>
          <div class="team-score">${state.teamBScore}</div>
        </div>
      </div>
      
      <div class="hud-body">
        <div class="hud-row">
          <span class="hud-label">${game.i18n.localize('CHRONOBALL.HUD.Attacking')}:</span>
          <span class="hud-value" style="color: ${attackingTeamColor}; font-weight: bold;">${attackingTeamName}</span>
        </div>
        
        <div class="hud-row">
          <span class="hud-label">${game.i18n.localize('CHRONOBALL.HUD.ActivePlayer') || 'Active Player'}:</span>
          <span class="hud-value" style="font-weight: bold; color: #FF9800;">${activeToken ? activeToken.name : 'None'}</span>
        </div>

        <div class="hud-row">
          <span class="hud-label">${game.i18n.localize('CHRONOBALL.HUD.BallCarrier')}:</span>
          <span class="hud-value">${carrier ? carrier.name : game.i18n.localize('CHRONOBALL.Errors.NoCarrier')}</span>
        </div>
        
        ${movementRowsHTML}
      </div>

      ${finishTurnHTML}
    `;
    
    this.element.innerHTML = html;
    this.updateVisibility();
  }
}