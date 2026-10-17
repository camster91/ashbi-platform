// Google Gemini AI provider wrapper

import { GoogleGenAI } from '@google/genai';
import env from '../../config/env.js';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

class GeminiProvider {
  constructor(modelOverride) {
    this.name = 'gemini';
    this.modelName = modelOverride || GEMINI_MODEL;
    this.client = new GoogleGenAI({ apiKey: env.geminiApiKey || 'unconfigured', httpOptions: { retryOptions: { attempts: 1 } } });
  }

  /** Whether the deployment gave this provider an API key. */
  isConfigured() {
    return Boolean(env.geminiApiKey);
  }

  async chat({ system, prompt, temperature = 0.3, maxTokens = 4096, signal }) {
    // A cancelled governance deadline must never dispatch a new request.
    signal?.throwIfAborted();
    const result = await this.client.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        systemInstruction: system, temperature, maxOutputTokens: maxTokens,
        abortSignal: signal,
        // Governance owns retries and cost accounting; the SDK cannot add calls.
        automaticContinuation: false,
        automaticFunctionCalling: { disable: true },
      },
    });
    const text = result.text;
    if (typeof text !== 'string') throw new Error('Gemini returned no text response');
    return text;
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
    } catch {
      // Keep provider content out of the outward error cause.
      console.error('Failed to parse Gemini JSON response:', response);
      throw new Error('AI returned invalid JSON');
    }
  }
}

export default GeminiProvider;
