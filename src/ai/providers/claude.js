// Claude AI provider wrapper

import Anthropic from '@anthropic-ai/sdk';
import env from '../../config/env.js';
import aiConfig from '../../config/ai.js';

class ClaudeProvider {
  constructor() {
    this.name = 'claude';
    this.client = new Anthropic({
      apiKey: env.anthropicApiKey
    });
  }

  async chat({ system, prompt, temperature = 0.3, maxTokens = aiConfig.maxTokens }) {
    const response = await this.client.messages.create({
      model: aiConfig.model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text;
  }

  async chatJSON(options) {
    const systemWithJSON = `${options.system}\n\nYou MUST respond with valid JSON only. No additional text or markdown formatting.`;

    const response = await this.chat({
      ...options,
      system: systemWithJSON
    });

    try {
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse Claude JSON response:', response);
      throw new Error('AI returned invalid JSON');
    }
  }
}

export default ClaudeProvider;
