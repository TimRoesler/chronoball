/**
 * ChronoballChat - Central chat message handler with commentary toggle
 */

export class ChronoballChat {
  
  /**
   * Check if commentary is enabled for current user
   */
  static isCommentaryEnabled() {
    return game.settings.get('chronoball', 'commentaryEnabled');
  }
  
  /**
   * Create chat message only if commentary is enabled for this user
   */
  static async createMessage(data) {
    if (!this.isCommentaryEnabled()) {
      console.log('Chronoball | Commentary disabled, skipping chat message');
      return null;
    }
    
    return await ChatMessage.create(data);
  }
  
  /**
   * Create a styled Chronoball chat message
   */
  static async createStyledMessage(content, speaker = null) {
    if (!this.isCommentaryEnabled()) {
      console.log('Chronoball | Commentary disabled, skipping styled message');
      return null;
    }
    
    const messageData = {
      content,
      speaker: speaker || { alias: 'Chronoball' }
    };
    
    return await ChatMessage.create(messageData);
  }
}