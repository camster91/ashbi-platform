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

  /**
   * Generate a text completion from a prompt string.
   * Convenience wrapper around chat() for simple prompt → response usage.
   * @param {string} prompt - The prompt text
   * @param {object} options - Optional: { maxTokens, temperature }
   * @returns {string} The generated text
   */
  async generate(prompt, options = {}) {
    const result = await getProvider().chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
    // chat() returns { content, ... } or just the content string depending on provider
    return typeof result === 'string' ? result : result?.content || result?.text || JSON.stringify(result);
  }
}

// Export singleton instance
export const aiClient = new AIClient();
export default aiClient;
