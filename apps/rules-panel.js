/**
 * ChronoballRulesPanel - Rules configuration panel
 */

import { ChronoballState } from '../scripts/state.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DND_SKILLS = {
  acr: "Acrobatics",
  ani: "Animal Handling",
  arc: "Arcana",
  ath: "Athletics",
  dec: "Deception",
  his: "History",
  ins: "Insight",
  itm: "Intimidation",
  inv: "Investigation",
  med: "Medicine",
  nat: "Nature",
  prc: "Perception",
  prf: "Performance",
  per: "Persuasion",
  rel: "Religion",
  slt: "Sleight of Hand",
  ste: "Stealth",
  sur: "Survival"
};

export class ChronoballRulesPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'chronoball-rules-panel',
    classes: ['chronoball-rules-panel'],
    tag: 'div',
    window: {
      title: 'CHRONOBALL.RulesPanel.Title',
      resizable: true
    },
    position: {
      width: 700,
      height: 'auto'
    }
  };
  
  static PARTS = {
    content: {
      template: 'modules/chronoball/templates/rules-panel.html'
    }
  };
  
  async _prepareContext() {
    const rules = ChronoballState.getRules();

    const savedSkills = new Set((rules.availableSkills || '').split(',').map(s => s.split(':')[0]));
    const dndSkills = Object.entries(DND_SKILLS).map(([id, label]) => ({
      id,
      label,
      checked: savedSkills.has(id)
    }));

    // Endzone region dropdowns — list the regions on the scene being configured.
    const scene = canvas.scene;
    const regions = [...(scene?.regions ?? [])].map(r => ({ id: r.id, name: r.name || r.id }));
    const buildOptions = (selectedId) => regions.map(r => ({ ...r, selected: r.id === selectedId }));
    const zoneAOptions = buildOptions(rules.zoneARegionId);
    const zoneBOptions = buildOptions(rules.zoneBRegionId);

    return { rules, dndSkills, zoneAOptions, zoneBOptions };
  }
  
  _onRender(context, options) {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll('.save-rules').forEach(btn => btn.addEventListener('click', this._onSave.bind(this)));
    root.querySelectorAll('.reset-rules').forEach(btn => btn.addEventListener('click', this._onReset.bind(this)));
  }
  
  async _onSave(event) {
    event.preventDefault();
    const form = this.element.querySelector('form');
    if (!form) return;
    const FormDataExt = foundry.applications?.ux?.FormDataExtended || FormDataExtended;
    const formData = new FormDataExt(form).object;

    // We need to parse the string values into numbers
    formData.ballMove = parseInt(formData.ballMove) || 0;
    formData.ballThrow = parseInt(formData.ballThrow) || 0;
    formData.legacyTotal = parseInt(formData.legacyTotal) || 90;
    formData.baseDC = parseInt(formData.baseDC) || 10;
    formData.stepDistance = parseInt(formData.stepDistance) || 10;
    formData.dcIncrease = parseInt(formData.dcIncrease) || 2;
    formData.interceptRadius = parseInt(formData.interceptRadius) || 10;
    formData.interceptTimeout = parseInt(formData.interceptTimeout) || 10000;
    formData.carrierTempHP = parseInt(formData.carrierTempHP) || 10;
    formData.carrierAuraScale = parseFloat(formData.carrierAuraScale) || 1.5;
    formData.activePlayerAuraScale = parseFloat(formData.activePlayerAuraScale) || 1.5;
    formData.maxPlayers = parseInt(formData.maxPlayers) || 3;
    formData.ballScale = parseFloat(formData.ballScale) || 1.0;
    formData.scoreRunIn = parseInt(formData.scoreRunIn) || 2;
    formData.scoreThrow = parseInt(formData.scoreThrow) || 1;
    formData.scorePassInZone = parseInt(formData.scorePassInZone) || 2;
    formData.fumbleStartDC = parseInt(formData.fumbleStartDC) || 10;
    formData.fumbleDamageThreshold = parseInt(formData.fumbleDamageThreshold) || 10;
    formData.fumbleDCIncrease = parseInt(formData.fumbleDCIncrease) || 2;

    // Handle checkboxes which are not present in formData if unchecked
    formData.interceptOnThrow = formData.interceptOnThrow || false;
    formData.blockAtReceiver = formData.blockAtReceiver || false;
    formData.allowRollModification = formData.allowRollModification || false;

    // Handle skill checkboxes
    const selectedSkills = Object.keys(formData)
      .filter(key => key.startsWith('skills.') && formData[key])
      .map(key => {
        const skillId = key.split('.')[1];
        return `${skillId}:${DND_SKILLS[skillId]}`;
      });
    formData.availableSkills = selectedSkills.join(',');

    // Clean up temporary skill data
    Object.keys(formData).forEach(key => {
      if (key.startsWith('skills.')) {
        delete formData[key];
      }
    });

    await ChronoballState.updateRules(formData);
    
    ui.notifications.info(game.i18n.localize('CHRONOBALL.RulesPanel.Save'));
    this.render(false);
  }
  
  async _onReset(event) {
    event.preventDefault();
    
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('CHRONOBALL.RulesPanel.Reset') },
      content: '<p>Are you sure you want to reset all rules to defaults?</p>',
      rejectClose: false
    });

    if (confirmed) {
      const defaults = ChronoballState.getDefaultRules();
      await ChronoballState.updateRules(defaults);
      ui.notifications.info('Rules reset to defaults');
      this.render();
    }
  }
}
