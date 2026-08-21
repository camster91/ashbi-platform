// MiniMax provider used only for monitoring incident triage.
// It intentionally does not participate in the Hub-wide AI_PROVIDER switch.

import env from '../../config/env.js';

const DEFAULT_MODEL = 'MiniMax-M2.5';

function extractJson(text) {
  const trimmed = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

export class MiniMaxMonitoringProvider {
  constructor({ apiKey = env.minimaxMonitoringApiKey, baseUrl = env.minimaxApiBase, model = env.minimaxMonitoringModel, fetchImpl = globalThis.fetch } = {}) {
    this.name = 'minimax-monitoring';
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || 'https://api.minimax.io/v1').replace(/\/$/, '');
    this.model = model || DEFAULT_MODEL;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async chatJSON({ system, prompt, temperature = 0.1, maxTokens = 350, signal } = {}) {
    if (!this.isConfigured()) {
      const error = new Error('MiniMax monitoring API key is not configured');
      error.code = 'MINIMAX_MONITORING_UNAVAILABLE';
      throw error;
    }

    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        stream: false,
        temperature,
        max_completion_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`MiniMax monitoring API error ${response.status}: ${body.slice(0, 300)}`);
      error.code = 'MINIMAX_MONITORING_REQUEST_FAILED';
      throw error;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      const error = new Error('MiniMax monitoring API returned no message content');
      error.code = 'MINIMAX_MONITORING_INVALID_RESPONSE';
      throw error;
    }
    return extractJson(content);
  }
}

export default MiniMaxMonitoringProvider;
