/**
 * ChronoballRoster - Manages team rosters and initiative
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballChat } from './chat.js';
import { ChronoballUtils, START_INITIATIVE } from './utils.js';

export class ChronoballRoster {
  static get MAX_PLAYERS_PER_TEAM() {
    return ChronoballState.getRules().maxPlayers || 3;
  }
  
  static initialize() {
    console.log('Chronoball | Roster manager initialized');
  }
  
  /**
   * Determine teams from endzone tiles
   */
  static async determineTeamsFromEndzones(sceneId) {
    const rules = ChronoballState.getRules();
    const matchScene = ChronoballUtils.getMatchScene(sceneId);

    console.log('Chronoball | Rules:', rules);
    console.log('Chronoball | Zone A:', rules.zoneARegionId);
    console.log('Chronoball | Zone B:', rules.zoneBRegionId);

    if (!rules.zoneARegionId || !rules.zoneBRegionId) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoEndzones'));
      return;
    }

    // Resolve endzone Regions on the match scene
    const zoneARegion = ChronoballState.getZoneRegion(rules.zoneARegionId, matchScene);
    const zoneBRegion = ChronoballState.getZoneRegion(rules.zoneBRegionId, matchScene);

    console.log('Chronoball | Zone A Region:', zoneARegion);
    console.log('Chronoball | Zone B Region:', zoneBRegion);

    if (!zoneARegion || !zoneBRegion) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoEndzones'));
      return;
    }

    const teamA = [];
    const teamB = [];

    // Find tokens (documents) in each zone on the match scene
    for (const tokenDoc of matchScene.tokens) {
      if (!tokenDoc.actor) continue;
      if (ChronoballState.isTokenCenterInRegion(tokenDoc, tokenDoc.x, tokenDoc.y, rules.zoneARegionId, matchScene)) {
        if (teamA.length < this.MAX_PLAYERS_PER_TEAM) {
          teamA.push(tokenDoc.actor.id);
          await ChronoballState.setTeamAssignment(tokenDoc.actor.id, 'A');
        }
      } else if (ChronoballState.isTokenCenterInRegion(tokenDoc, tokenDoc.x, tokenDoc.y, rules.zoneBRegionId, matchScene)) {
        if (teamB.length < this.MAX_PLAYERS_PER_TEAM) {
          teamB.push(tokenDoc.actor.id);
          await ChronoballState.setTeamAssignment(tokenDoc.actor.id, 'B');
        }
      }
    }
    
    if (teamA.length === 0 && teamB.length === 0) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoPlayersFound'));
      return;
    }
    
    ui.notifications.info(`Teams determined: Team A (${teamA.length}), Team B (${teamB.length})`);
    
    console.log('Chronoball | Teams:', { teamA, teamB });
  }
  
  /**
   * Get roster for a team
   */
  static getTeamRoster(team) {
    const actors = ChronoballState.getTeamRoster(team);
    return actors.slice(0, this.MAX_PLAYERS_PER_TEAM);
  }
  
  /**
   * Rebuild custom turn order (alternating teams)
   * Attacking team goes first, then defending team alternates
   */
  static async rebuildTurnOrder() {
    const matchScene = ChronoballUtils.getMatchScene();
    if (!matchScene) return;

    const state = ChronoballState.getMatchState();
    const teamA = this.getTeamRoster('A');
    const teamB = this.getTeamRoster('B');
    
    // Determine which team is attacking
    const attackingTeam = state.attackingTeam;
    const attackingRoster = attackingTeam === 'A' ? teamA : teamB;
    const defendingRoster = attackingTeam === 'A' ? teamB : teamA;
    
    const attackingTokens = [];
    const defendingTokens = [];
    
    for (const actor of attackingRoster) {
      const tokenDoc = matchScene.tokens.find(t => t.actor?.id === actor.id);
      if (tokenDoc) attackingTokens.push(tokenDoc.id);
    }

    for (const actor of defendingRoster) {
      const tokenDoc = matchScene.tokens.find(t => t.actor?.id === actor.id);
      if (tokenDoc) defendingTokens.push(tokenDoc.id);
    }

    // Rebuild with alternating pattern: Attacker, Defender, Attacker, Defender...
    const turnOrder = [];
    const maxLength = Math.max(attackingTokens.length, defendingTokens.length);
    for (let i = 0; i < maxLength; i++) {
      if (i < attackingTokens.length) turnOrder.push(attackingTokens[i]);
      if (i < defendingTokens.length) turnOrder.push(defendingTokens[i]);
    }
    
    await ChronoballState.updateState({
      turnOrder: turnOrder,
      currentTurnIndex: turnOrder.length > 0 ? 0 : -1,
      round: 1
    });

    const attackingTeamName = attackingTeam === 'A' ? state.teamAName : state.teamBName;
    ui.notifications.info(`Turn order established! ${attackingTeamName} (attacking) goes first.`);
    
    console.log('Chronoball | Turn order rebuilt with alternating pattern');
  }
  
  /**
   * Heal all rosters
   */
  static async healAllRosters() {
    // Only GM/Host can heal
    if (!ChronoballSocket.isPrimaryGM()) {
      ui.notifications.error('Only the Host can heal rosters');
      return;
    }
    
    const teamA = this.getTeamRoster('A');
    const teamB = this.getTeamRoster('B');
    
    const allActors = [...teamA, ...teamB];
    
    for (const actor of allActors) {
      const maxHP = actor.system.attributes.hp.max;
      await actor.update({
        'system.attributes.hp.value': maxHP,
        'system.attributes.hp.temp': 0
      });
    }
    
    ui.notifications.info('All rosters healed');
  }
  
  /**
   * Clear all buffs and effects from rosters
   */
  static async clearAllEffects() {
    // Only GM/Host can clear effects
    if (!ChronoballSocket.isPrimaryGM()) {
      ui.notifications.error('Only the Host can clear effects');
      return;
    }
    
    const teamA = this.getTeamRoster('A');
    const teamB = this.getTeamRoster('B');
    
    const allActors = [...teamA, ...teamB];
    
    for (const actor of allActors) {
      const effectIds = actor.effects.map(e => e.id);
      if (effectIds.length > 0) {
        await actor.deleteEmbeddedDocuments('ActiveEffect', effectIds);
      }
    }
    
    ui.notifications.info('All effects cleared');
  }
  
  /**
   * Send short rest request to players
   */
  static async sendShortRestRequest() {
    const teamA = this.getTeamRoster('A');
    const teamB = this.getTeamRoster('B');
    
    const allActors = [...teamA, ...teamB];
    
    const content = `
      <div class="chronoball-chat-message">
        <div class="message-header">
          <span class="message-icon">⏸️</span>
          <span class="message-title">${game.i18n.localize('CHRONOBALL.Chat.ShortRestTitle')}</span>
        </div>
        <div class="message-body">
          <p>${game.i18n.localize('CHRONOBALL.Chat.ShortRestPrompt')}</p>
        </div>
      </div>
    `;
    
    await ChronoballChat.createMessage({
      content,
      whisper: allActors.map(a => {
        const owners = Object.entries(a.ownership)
          .filter(([userId, level]) => level === 3)
          .map(([userId]) => userId);
        return owners;
      }).flat()
    });
    
    ui.notifications.info('Short rest request sent');
  }
  
  /**
   * Handle token deletion
   */
  static async onTokenDeleted(tokenDoc) {
    if (tokenDoc.getFlag?.('monster-summoner', 'temp')) return;

    const actorId = tokenDoc.actorId;
    if (!actorId) return;

    // Ignore deletion of the Chronoball (ball) token
    if (
      tokenDoc.getFlag?.(ChronoballState.FLAG_SCOPE, ChronoballState.FLAG_BALL_TOKEN) === true
      || ChronoballState.isBallToken(tokenDoc.id)
      || (tokenDoc.name || '').toLowerCase().includes('chronoball')
    ) return;

    if (!ChronoballState.getTeamAssignment(actorId)) return;

    // Clear team assignment if this was the last token for this actor.
    // Use the deleted token's own scene (tokenDoc.parent) so this is correct
    // regardless of which scene any client is currently viewing.
    const sceneTokens = tokenDoc.parent?.tokens ?? [];
    const remainingTokens = sceneTokens.filter(t => t.actor?.id === actorId);
    if (remainingTokens.length === 0) {
      await ChronoballState.clearTeamAssignment(actorId);
    }
  }

  /**
   * Get roster display data
   */
  static getRosterDisplayData() {
    const teamA = this.getTeamRoster('A');
    const teamB = this.getTeamRoster('B');
    
    return {
      teamA: teamA.map(actor => ({
        id: actor.id,
        name: actor.name,
        img: actor.img
      })),
      teamB: teamB.map(actor => ({
        id: actor.id,
        name: actor.name,
        img: actor.img
      }))
    };
  }
}
