/**
 * ChronoballCarrier - Handles carrier effects, aura, and temp HP
 */

import { ChronoballState } from './state.js';
import { ChronoballSocket } from './socket.js';
import { ChronoballUtils } from './utils.js';

export class ChronoballCarrier {
  static async executeSetCarrier(tokenId) {
    const token = ChronoballState.getMatchTokenDoc(tokenId);
    if (!token) return;

    // Ensure this runs as authorized executor (GM/Host, or owner if no GM online)
    if (!ChronoballSocket.isAuthorizedExecutor(token)) {
      console.error('Chronoball | executeSetCarrier called by unauthorized user!');
      return;
    }

    // Clear any existing carrier first
    const currentCarrier = ChronoballState.getCarrierTokenDoc();
    if (currentCarrier) {
      await this.removeCarrierEffects(currentCarrier);
    }

    // Set new carrier
    await ChronoballState.setCarrierStatus(tokenId, true);
    await this.applyCarrierEffects(token);

    ChronoballUtils.log('Chronoball | Carrier set:', token.name);
  }

  static async executeClearCarrier() {
    const carrier = ChronoballState.getCarrierTokenDoc();
    if (!carrier) {
      // No carrier exists, or token was deleted/not found - ensure state is cleared
      await ChronoballState.updateState({ carrierId: null });
      ChronoballUtils.log('Chronoball | executeClearCarrier called but no carrier exists/found, state cleared');
      return;
    }

    if (!ChronoballSocket.isAuthorizedExecutor(carrier)) {
      console.error('Chronoball | executeClearCarrier called by unauthorized user!');
      return;
    }

    await this.removeCarrierEffects(carrier);
    await ChronoballState.setCarrierStatus(carrier.id, false);
    await ChronoballState.updateState({ carrierId: null });

    ChronoballUtils.log('Chronoball | Carrier cleared');
  }

  static async applyCarrierEffects(token) {
    const rules = ChronoballState.getRules();

    // Store carrier flag on token document (this works for all users)
    await token.setFlag('chronoball', 'isCarrier', true);
    await token.setFlag('chronoball', 'carrierTempHP', rules.carrierTempHP || 0);
    // Save previous temp HP so we can restore/remove on loss of possession
    try {
      const prev = Number(token?.actor?.system?.attributes?.hp?.temp ?? 0);
      await token.setFlag('chronoball', 'prevTempHP', isNaN(prev) ? 0 : prev);
    } catch (e) {
      console.warn('Chronoball | Could not store prevTempHP:', e);
    }

    // Grant Temp HP to the carrier (GM-side, safe)
    try {
      const actor = token.actor;
      const grant = Number(rules.carrierTempHP) || 0;
      if (grant > 0 && actor?.system?.attributes?.hp) {
        const current = Number(actor.system.attributes.hp.temp ?? 0);
        // 5e semantics: don't stack temp HP; replace only if higher
        const newTemp = Math.max(current, grant);
        if (!Number.isNaN(newTemp) && newTemp !== current) {
          await actor.update({ 'system.attributes.hp.temp': newTemp }, { chronoball_internal: true });
        }
      }
    } catch (err) {
      console.warn('Chronoball | Could not apply temp HP to carrier:', err);
    }

    // Apply Sequencer aura if configured
    if (rules.carrierAuraSource && game.modules.get('sequencer')?.active) {
      await this.applySequencerAura(token, rules);
    }

    ChronoballUtils.log(`Chronoball | Carrier effects applied to ${token.name} (temp HP noted: ${rules.carrierTempHP})`);
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

    try {
      await auraEffect.play();
    } catch (e) {
      ChronoballUtils.log('Chronoball | Sequencer aura play failed (host viewing another scene?), continuing:', e);
    }

    ChronoballUtils.log(`Chronoball | Sequencer aura applied to ${token.name}`);
  }

  static async removeCarrierEffects(token) {
    // Read flags BEFORE unsetting them
    const grant = Number(token.getFlag('chronoball', 'carrierTempHP') ?? 0);
    const prev = Number(token.getFlag('chronoball', 'prevTempHP') ?? 0);

    // Remove carrier flags
    await token.unsetFlag('chronoball', 'isCarrier');
    await token.unsetFlag('chronoball', 'carrierTempHP');

    // Remove/restore Temp HP that were granted for carrying the ball
    try {
      const actor = token.actor;
      const hasHP = !!actor?.system?.attributes?.hp;
      if (hasHP) {
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
          await actor.update({ 'system.attributes.hp.temp': newTemp }, { chronoball_internal: true });
        }
      }
    } catch (err) {
      console.warn('Chronoball | Could not remove/restore carrier Temp HP:', err);
    }
    // Clear helper flags
    await token.unsetFlag('chronoball', 'prevTempHP');

    // Remove Sequencer aura if it exists
    if (game.modules.get('sequencer')?.active) {
      await Sequencer.EffectManager.endEffects({ name: `chronoball-aura-${token.id}` });
      ChronoballUtils.log(`Chronoball | Sequencer aura removed from ${token.name}`);
    }

    ChronoballUtils.log(`Chronoball | Carrier effects removed from ${token.name}`);
  }
}
