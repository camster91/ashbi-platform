// AI Provider factory - picks provider based on AI_PROVIDER env var or runtime setting

import ClaudeProvider from './claude.js';
import GeminiProvider, { GEMINI_CREATIVE_MODEL } from './gemini.js';
import OllamaProvider from './ollama.js';
import env from '../../config/env.js';

let currentProvider = null;
let currentProviderName = null;
let creativeProvider = null;

const VALID_PROVIDERS = ['claude', 'gemini', 'ollama'];

/**
 * Get the active AI provider instance.
 * Defaults to env.aiProvider ('claude' | 'gemini' | 'ollama'), can be switched at runtime.
 */
export function getProvider() {
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
      currentProvider = new OllamaProvider();
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
 * Switch the AI provider at runtime (admin only).
 * @param {'claude' | 'gemini' | 'ollama'} providerName
 */
export function setProvider(providerName) {
  if (!VALID_PROVIDERS.includes(providerName)) {
    throw new Error(`Unknown AI provider: ${providerName}. Use ${VALID_PROVIDERS.join(', ')}.`);
  }
  currentProviderName = providerName;
  currentProvider = null; // Force re-creation on next getProvider()
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

export default { getProvider, setProvider, getProviderName, getCreativeProvider };
