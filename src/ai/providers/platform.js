// Platform AI provider: the deployment-wide provider picked by AI_PROVIDER or
// the platform operator's runtime switch. Organizations without a BYOK
// connection use it (see src/ai/governance.js and docs/ai-byok.md).

import ClaudeProvider from './claude.js';
import GeminiProvider, { GEMINI_CREATIVE_MODEL } from './gemini.js';
import OllamaProvider from './ollama.js';
import env from '../../config/env.js';

let currentProvider = null;
let currentProviderName = null;
let currentOllamaModel = null;
let creativeProvider = null;

const VALID_PROVIDERS = ['claude', 'gemini', 'ollama'];

/**
 * Get the deployment-wide platform provider instance. Callers should use
 * getProvider() from ./index.js instead, which applies kill switches, BYOK
 * connections and budgets before delegating here.
 * Defaults to env.aiProvider ('claude' | 'gemini' | 'ollama'), can be switched at runtime.
 */
export function getPlatformProvider() {
  const desiredProvider = currentProviderName || env.aiProvider;

  if (currentProvider && currentProvider.name === desiredProvider) {
    return currentProvider;
  }

  switch (desiredProvider) {
    case 'gemini':
      currentProvider = new GeminiProvider();
      currentProviderName = 'gemini';
      break;
    case 'ollama':
      currentProvider = new OllamaProvider(currentOllamaModel || undefined);
      currentProviderName = 'ollama';
      break;
    case 'claude':
    default:
      currentProvider = new ClaudeProvider();
      currentProviderName = 'claude';
      break;
  }

  return currentProvider;
}

/**
 * Switch the AI provider at runtime. This is process-wide and affects every
 * organization, so callers must restrict it to platform operators.
 * @param {'claude' | 'gemini' | 'ollama'} providerName
 * @param {{ model?: string }} [options] Ollama model to use instead of OLLAMA_MODEL
 */
export function setProvider(providerName, { model } = {}) {
  if (!VALID_PROVIDERS.includes(providerName)) {
    throw new Error(`Unknown AI provider: ${providerName}. Use ${VALID_PROVIDERS.join(', ')}.`);
  }
  currentProviderName = providerName;
  if (providerName === 'ollama' && model) currentOllamaModel = model;
  currentProvider = null; // Force re-creation on next getPlatformProvider()
}

/**
 * Get the Ollama model the provider uses, including any runtime override.
 */
export function getOllamaModel() {
  return currentOllamaModel || env.ollamaModel;
}

/**
 * Get the name of the current AI provider.
 */
export function getProviderName() {
  return currentProviderName || env.aiProvider;
}

/**
 * Get the creative/image AI provider (always Gemini with gemini-3-pro-image-preview).
 */
export function getCreativeProvider() {
  if (!creativeProvider) {
    creativeProvider = new GeminiProvider(GEMINI_CREATIVE_MODEL);
  }
  return creativeProvider;
}

