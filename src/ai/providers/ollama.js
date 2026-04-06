// Ollama Cloud AI provider
// Docs: https://docs.ollama.com/cloud
// API:  POST https://ollama.com/api/chat
// Auth: Authorization: Bearer $OLLAMA_API_KEY

import env from '../../config/env.js';

// Available Ollama cloud models
export const OLLAMA_MODELS = {
  DEFAULT: 'gpt-oss:120b-cloud',   // Fast, capable — good for most tasks
  FAST:    'gpt-oss:20b-cloud',    // Low latency
  CODER:   'qwen3-coder:480b-cloud', // Best for code/structured output
  LARGE:   'deepseek-v3.1:671b-cloud', // Highest quality
};

class OllamaProvider {
  constructor(modelOverride) {
    this.name = 'ollama';
    this.modelName = modelOverride || env.ollamaModel || OLLAMA_MODELS.DEFAULT;
    // Strip /v1 suffix if present — cloud API uses /api/chat directly
    this.baseUrl = (env.ollamaBaseUrl || 'https://ollama.com').replace(/\/v1\/?$/, '').replace(/\/$/, '');
    this.apiKey = env.ollamaApiKey;
  }

  _headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  async chat({ system, prompt, temperature = 0.3, maxTokens = 4096 }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.message?.content ?? '';
  }

  async chatJSON(options) {
    const systemWithJSON = `${options.system || ''}\n\nRespond with valid JSON only. No markdown fences, no explanation — raw JSON only.`.trim();

    const response = await this.chat({ ...options, system: systemWithJSON });

    try {
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse Ollama JSON response:', response.slice(0, 500));
      throw new Error('AI returned invalid JSON');
    }
  }

  // Fetch available cloud models from Ollama
  static async listCloudModels(apiKey) {
    try {
      const res = await fetch('https://ollama.com/api/tags', {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return Object.values(OLLAMA_MODELS);
      const data = await res.json();
      return (data.models || []).map(m => m.name).filter(n => n.includes(':cloud'));
    } catch {
      return Object.values(OLLAMA_MODELS);
    }
  }
}

export default OllamaProvider;
