// AI Provider factory - picks provider based on AI_PROVIDER env var or runtime setting

import ClaudeProvider from './claude.js';
import GeminiProvider, { GEMINI_CREATIVE_MODEL } from './gemini.js';
import env from '../../config/env.js';

let currentProvider = null;
let currentProviderName = null;
let creativeProvider = null;

/**
 * Get the active AI provider instance.
 * Defaults to env.aiProvider ('claude' | 'gemini'), can be switched at runtime.
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
 * @param {'claude' | 'gemini'} providerName
 */
export function setProvider(providerName) {
  if (!['claude', 'gemini'].includes(providerName)) {
    throw new Error(`Unknown AI provider: ${providerName}. Use 'claude' or 'gemini'.`);
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
