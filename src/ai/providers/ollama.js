// Ollama Cloud AI provider wrapper (OpenAI-compatible API)

import env from '../../config/env.js';

class OllamaProvider {
  constructor() {
    this.name = 'ollama';
    this.baseUrl = env.ollamaBaseUrl;
    this.apiKey = env.ollamaApiKey;
    this.model = env.ollamaModel;
  }

  async chat({ system, prompt, temperature = 0.3, maxTokens = 4096 }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
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
      console.error('Failed to parse Ollama JSON response:', response);
      throw new Error('AI returned invalid JSON');
    }
  }
}

export default OllamaProvider;
