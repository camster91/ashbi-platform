// Google Gemini AI provider wrapper

import { GoogleGenerativeAI } from '@google/generative-ai';
import env from '../../config/env.js';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_CREATIVE_MODEL = 'gemini-3-pro-image-preview';

class GeminiProvider {
  constructor(modelOverride) {
    this.name = 'gemini';
    this.modelName = modelOverride || GEMINI_MODEL;
    this.client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  async chat({ system, prompt, temperature = 0.3, maxTokens = 4096 }) {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: system,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      }
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
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
      console.error('Failed to parse Gemini JSON response:', response);
      throw new Error('AI returned invalid JSON');
    }
  }
}

export { GEMINI_CREATIVE_MODEL };
export default GeminiProvider;
