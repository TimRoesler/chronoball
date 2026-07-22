/**
 * ChronoballChat - Central chat message handler
 */

export class ChronoballChat {

  static async createMessage(data) {
    return await ChatMessage.create(data);
  }
}
