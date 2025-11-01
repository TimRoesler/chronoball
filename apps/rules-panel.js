/**
 * ChronoballRulesPanel - Rules configuration panel
 */

import { ChronoballState } from '../scripts/state.js';

export class ChronoballRulesPanel extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'chronoball-rules-panel',
      classes: ['chronoball-rules-panel'],
      title: game.i18n.localize('CHRONOBALL.RulesPanel.Title'),
      width: 700,
      height: 'auto',
      resizable: true,
      template: 'modules/chronoball/templates/rules-panel.html'
    });
  }
  
  getData() {
    const rules = ChronoballState.getRules();

    // Prepare skill data for checkboxes
    const dndSkillsList = {
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

    const savedSkills = new Set((rules.availableSkills || '').split(',').map(s => s.split(':')[0]));
    const dndSkills = Object.entries(dndSkillsList).map(([id, label]) => ({
      id,
      label,
      checked: savedSkills.has(id)
    }));

    return { rules, dndSkills };
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    html.find('.save-rules').click(this._onSave.bind(this));
    html.find('.reset-rules').click(this._onReset.bind(this));
  }
  
  async _onSave(event) {
    event.preventDefault();
    const form = this.element.find('form')[0];
    const formData = new FormDataExtended(form).object;

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

    // Handle skill checkboxes
    const dndSkillsList = {
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

    const selectedSkills = Object.keys(formData)
      .filter(key => key.startsWith('skills.') && formData[key])
      .map(key => {
        const skillId = key.split('.')[1];
        return `${skillId}:${dndSkillsList[skillId]}`;
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
    
    const confirm = await Dialog.confirm({
      title: game.i18n.localize('CHRONOBALL.RulesPanel.Reset'),
      content: `<p>Are you sure you want to reset all rules to defaults?</p>`
    });
    
    if (confirm) {
      const defaults = ChronoballState.getDefaultRules();
      await ChronoballState.updateRules(defaults);
      ui.notifications.info('Rules reset to defaults');
      this.render();
    }
  }
}