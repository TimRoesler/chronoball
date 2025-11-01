/**
 * ChronoballRoster - Manages team rosters and initiative
 */

import { ChronoballState } from './state.js';
import { ChronoballChat } from './chat.js';

export class ChronoballRoster {
  static MAX_PLAYERS_PER_TEAM = 3;
  
  static initialize() {
    console.log('Chronoball | Roster manager initialized');
  }
  
  /**
   * Determine teams from endzone tiles
   */
  static async determineTeamsFromEndzones() {
    const rules = ChronoballState.getRules();
    
    console.log('Chronoball | Rules:', rules);
    console.log('Chronoball | Zone A:', rules.zoneATileId);
    console.log('Chronoball | Zone B:', rules.zoneBTileId);
    
    if (!rules.zoneATileId || !rules.zoneBTileId) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoEndzones'));
      return;
    }
    
    // Extract Tile ID from UUID (format: Scene.xxx.Tile.yyy)
    const zoneATileIdOnly = rules.zoneATileId.split('.').pop();
    const zoneBTileIdOnly = rules.zoneBTileId.split('.').pop();
    
    const zoneATile = canvas.tiles.get(zoneATileIdOnly);
    const zoneBTile = canvas.tiles.get(zoneBTileIdOnly);
    
    console.log('Chronoball | Zone A Tile ID:', zoneATileIdOnly, 'Tile:', zoneATile);
    console.log('Chronoball | Zone B Tile ID:', zoneBTileIdOnly, 'Tile:', zoneBTile);
    
    if (!zoneATile || !zoneBTile) {
      ui.notifications.error(game.i18n.localize('CHRONOBALL.Errors.NoEndzones'));
      return;
    }
    
    const teamA = [];
    const teamB = [];
    
    // Find tokens in each zone
    for (const token of canvas.tokens.placeables) {
      if (this.isTokenInTile(token, zoneATile)) {
        if (teamA.length < this.MAX_PLAYERS_PER_TEAM) {
          teamA.push(token.actor.id);
          await ChronoballState.setTeamAssignment(token.actor.id, 'A');
        }
      } else if (this.isTokenInTile(token, zoneBTile)) {
        if (teamB.length < this.MAX_PLAYERS_PER_TEAM) {
          teamB.push(token.actor.id);
          await ChronoballState.setTeamAssignment(token.actor.id, 'B');
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
   * Check if token is within tile bounds
   */
  static isTokenInTile(token, tile) {
    const tokenBounds = token.bounds;
    const tileBounds = tile.bounds;
    
    const tokenCenterX = token.x + (token.w / 2);
    const tokenCenterY = token.y + (token.h / 2);
    
    return (
      tokenCenterX >= tileBounds.x &&
      tokenCenterX <= tileBounds.x + tileBounds.width &&
      tokenCenterY >= tileBounds.y &&
      tokenCenterY <= tileBounds.y + tileBounds.height
    );
  }
  
  /**
   * Get roster for a team
   */
  static getTeamRoster(team) {
    const actors = ChronoballState.getTeamRoster(team);
    return actors.slice(0, this.MAX_PLAYERS_PER_TEAM);
  }
  
  /**
   * Rebuild initiative order (alternating teams with rolled initiative)
   * Attacking team goes first, then defending team alternates
   */
  static async rebuildInitiative(reroll = true) {
    await ChronoballState.ensureCombat();
    
    const combat = game.combat;
    if (!combat) return;
    
    const state = ChronoballState.getMatchState();
    const teamA = this.getTeamRoster('A');
    const teamB = this.getTeamRoster('B');
    
    // Determine which team is attacking
    const attackingTeam = state.attackingTeam;
    const attackingRoster = attackingTeam === 'A' ? teamA : teamB;
    const defendingRoster = attackingTeam === 'A' ? teamB : teamA;
    
    // Clear existing combatants
    const combatantIds = combat.combatants.map(c => c.id);
    await combat.deleteEmbeddedDocuments('Combatant', combatantIds);
    
    // Create combatants with temporary initiative
    const combatants = [];
    
    // Add attacking team
    for (const actor of attackingRoster) {
      const token = canvas.tokens.placeables.find(t => t.actor.id === actor.id);
      if (token) {
        combatants.push({
          tokenId: token.id,
          sceneId: canvas.scene.id,
          actorId: actor.id,
          initiative: null // Will be rolled
        });
      }
    }
    
    // Add defending team
    for (const actor of defendingRoster) {
      const token = canvas.tokens.placeables.find(t => t.actor.id === actor.id);
      if (token) {
        combatants.push({
          tokenId: token.id,
          sceneId: canvas.scene.id,
          actorId: actor.id,
          initiative: null // Will be rolled
        });
      }
    }
    
    await combat.createEmbeddedDocuments('Combatant', combatants);
    
    // Roll initiative for all combatants
    await combat.rollAll();
    
    // Now sort and rebuild with alternating pattern
    const combatantDocs = combat.combatants.contents;
    
    // Separate by team and sort by initiative (highest first)
    const attackingCombatants = combatantDocs
      .filter(c => {
        const actor = game.actors.get(c.actorId);
        const team = ChronoballState.getTeamAssignment(actor.id);
        return team === attackingTeam;
      })
      .sort((a, b) => b.initiative - a.initiative);
    
    const defendingCombatants = combatantDocs
      .filter(c => {
        const actor = game.actors.get(c.actorId);
        const team = ChronoballState.getTeamAssignment(actor.id);
        return team !== attackingTeam;
      })
      .sort((a, b) => b.initiative - a.initiative);
    
    // Rebuild with alternating pattern: Attacker, Defender, Attacker, Defender...
    const newInitiatives = [];
    const maxLength = Math.max(attackingCombatants.length, defendingCombatants.length);
    
    let currentInit = 100;
    for (let i = 0; i < maxLength; i++) {
      // Attacker goes first
      if (i < attackingCombatants.length) {
        newInitiatives.push({
          id: attackingCombatants[i].id,
          initiative: currentInit--
        });
      }
      
      // Then defender
      if (i < defendingCombatants.length) {
        newInitiatives.push({
          id: defendingCombatants[i].id,
          initiative: currentInit--
        });
      }
    }
    
    // Update all combatant initiatives
    for (const update of newInitiatives) {
      await combat.updateEmbeddedDocuments('Combatant', [{
        _id: update.id,
        initiative: update.initiative
      }]);
    }
    
    // Start combat if not started
    if (!combat.started) {
      await combat.startCombat();
    } else {
      // Reset to first combatant
      await combat.update({ turn: 0 });
    }
    
    const attackingTeamName = attackingTeam === 'A' ? state.teamAName : state.teamBName;
    ui.notifications.info(`Initiative rolled! ${attackingTeamName} (attacking) goes first.`);
    
    console.log('Chronoball | Initiative rebuilt with rolled values, alternating pattern');
  }
  
  /**
   * Heal all rosters
   */
  static async healAllRosters() {
    // Only GM can heal
    if (!game.user.isGM) {
      ui.notifications.error('Only GM can heal rosters');
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
    // Only GM can clear effects
    if (!game.user.isGM) {
      ui.notifications.error('Only GM can clear effects');
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
          <span class="message-title">Short Rest</span>
        </div>
        <div class="message-body">
          <p>The GM has called for a short rest. Please take your short rest.</p>
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
/**
 * Handle token deletion
 */
static async onTokenDeleted(tokenDoc) {
  const actorId = tokenDoc.actorId;
  if (!actorId) return;

  // Ignore deletion of the Chronoball (ball) token
  try {
    const { ChronoballState } = await import('./state.js');
    if (ChronoballState.isBallToken(tokenDoc.id)) return;
  } catch (e) {
    if ((tokenDoc.name || '').toLowerCase().includes('chronoball')) return;
  }

  // Clear team assignment if this was the last token for this actor
  const remainingTokens = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
  if (remainingTokens.length === 0) {
    const { ChronoballState } = await import('./state.js');
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