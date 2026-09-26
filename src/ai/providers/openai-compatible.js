// OpenAI-compatible chat completions provider for organization BYOK
// connections (#413, docs/ai-byok.md).
//
// One request per call: there are no automatic retries, so a provider failure
// is reported to the caller instead of silently spending the workspace's
// budget again. Redirects are never followed. Errors are mapped to AiProviderError types and never include
// the key or the provider's response body.

import { AiProviderError } from '../errors.js';

export const OPENAI_COMPATIBLE_KIND = 'openai_compatible';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Normalize a base URL to its origin + path prefix without a trailing slash
 * or trailing `/v1`, so `https://host`, `https://host/` and `https://host/v1`
 * all address `https://host/v1/chat/completions`.
 * @param {string} baseUrl
 */
export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

export const JSON_ONLY_INSTRUCTION = 'You MUST respond with valid JSON only. No additional text or markdown formatting.';

/** Parse a JSON reply, tolerating a markdown code fence around it. */
export function parseJsonReply(text) {
  let jsonStr = String(text ?? '').trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error('AI returned invalid JSON');
  }
}

/** Rough token count for providers that do not report usage (~4 chars/token). */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/** Map an upstream HTTP status (and provider error code) to an error type. */
export function classifyProviderStatus(status, providerCode) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return providerCode === 'insufficient_quota' ? 'quota' : 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'upstream';
}

class OpenAICompatibleProvider {
  /**
   * @param {{ baseUrl: string, apiKey: string, model: string, timeoutMs?: number, fetchImpl?: typeof fetch }} options
   */
  constructor({ baseUrl, apiKey, model, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, fetchImpl }) {
    this.name = OPENAI_COMPATIBLE_KIND;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.modelName = model;
    this.timeoutMs = timeoutMs;
    // Non-enumerable so the key never appears when the provider is logged,
    // serialized or inspected with Object.keys / JSON.stringify.
    Object.defineProperty(this, 'apiKey', { value: apiKey, enumerable: false });
    Object.defineProperty(this, 'fetchImpl', { value: fetchImpl ?? ((...args) => globalThis.fetch(...args)), enumerable: false });
  }

  toJSON() {
    return { name: this.name, baseUrl: this.baseUrl, modelName: this.modelName };
  }

  _headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * One HTTP request with a hard timeout. Returns the parsed JSON body.
   * @param {string} path
   * @param {RequestInit} init
   */
  async _request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res;
      try {
        // Never follow redirects: a 3xx could send the key and prompt to a
        // host (or scheme) the outbound URL policy never checked.
        res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: this._headers(), signal: controller.signal, redirect: 'manual' });
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') throw new AiProviderError('timeout');
        throw new AiProviderError('upstream');
      }
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        throw new AiProviderError('upstream', { upstreamStatus: res.status || null });
      }
      let body = null;
      try {
        body = await res.json();
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') throw new AiProviderError('timeout');
        body = null;
      }
      if (!res.ok) {
        const providerCode = typeof body?.error?.code === 'string' ? body.error.code : body?.error?.type;
        throw new AiProviderError(classifyProviderStatus(res.status, providerCode), { upstreamStatus: res.status });
      }
      if (!body || typeof body !== 'object') throw new AiProviderError('invalid_response', { upstreamStatus: res.status });
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Chat completion with token usage.
   * @returns {Promise<{ content: string, model: string, usage: { promptTokens: number, completionTokens: number, estimated: boolean } }>}
   */
  async complete({ system, prompt, messages, temperature = 0.3, maxTokens = 4096, model } = {}) {
    const chatMessages = [];
    if (system) chatMessages.push({ role: 'system', content: system });
    if (Array.isArray(messages) && messages.length) {
      for (const message of messages) {
        if (message && typeof message.content === 'string') {
          chatMessages.push({ role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user', content: message.content });
        }
      }
    }
    if (prompt) chatMessages.push({ role: 'user', content: prompt });

    const useModel = model || this.modelName;
    const body = await this._request('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: useModel, messages: chatMessages, temperature, max_tokens: maxTokens, stream: false }),
    });
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new AiProviderError('invalid_response');
    const reported = Number.isInteger(body.usage?.prompt_tokens) && Number.isInteger(body.usage?.completion_tokens);
    // A provider that omits usage is still metered: about four characters per
    // token, flagged as an estimate.
    const usage = reported
      ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, estimated: false }
      : {
        promptTokens: estimateTokens(chatMessages.map((message) => message.content).join('\n')),
        completionTokens: estimateTokens(content),
        estimated: true,
      };
    return { content, model: typeof body.model === 'string' ? body.model : useModel, usage };
  }

  /** Same interface and return shape as the platform providers: a string. */
  async chat(options) {
    return (await this.complete(options)).content;
  }

  async chatJSON(options) {
    const systemWithJSON = `${options?.system || ''}\n\n${JSON_ONLY_INSTRUCTION}`.trim();
    return parseJsonReply(await this.chat({ ...options, system: systemWithJSON }));
  }

  /** GET /v1/models: the model ids the key can use. */
  async listModels() {
    const body = await this._request('/v1/models', { method: 'GET' });
    const list = Array.isArray(body.data) ? body.data : [];
    return list.map((entry) => entry?.id).filter((id) => typeof id === 'string');
  }
}

export default OpenAICompatibleProvider;
