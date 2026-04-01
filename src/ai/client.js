// AI client wrapper - delegates to active provider (Claude or Gemini)

import { getProvider } from './providers/index.js';

class AIClient {
  /**
   * Send a message to the AI and get a response
   */
  async chat(options) {
    return getProvider().chat(options);
  }

  /**
   * Send a message and parse JSON response
   */
  async chatJSON(options) {
    return getProvider().chatJSON(options);
  }
}

// Export singleton instance
export const aiClient = new AIClient();
export default aiClient;
