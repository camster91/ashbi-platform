// AI provider entry point.
//
// getProvider() returns the governed provider: its chat / chatJSON resolve the
// current request's or job's organization at call time and apply the AI kill
// switches, the organization's BYOK connection and its budget before
// delegating (src/ai/governance.js, docs/ai-byok.md). An organization with no
// connection gets the platform provider exactly as before.

import { aiGovernance } from '../governance.js';
import { getPlatformProvider } from './platform.js';

export {
  getPlatformProvider,
  setProvider,
  getOllamaModel,
  getProviderName,
  getCreativeProvider,
} from './platform.js';

const governedProvider = Object.freeze({
  /** Name of the platform provider (BYOK routing is decided per call). */
  get name() {
    return getPlatformProvider().name;
  },
  get modelName() {
    return getPlatformProvider().modelName;
  },
  chat: (options) => aiGovernance.chat(options),
  chatJSON: (options) => aiGovernance.chatJSON(options),
});

/**
 * The provider every AI feature should call. Synchronous, like before; the
 * organization is resolved when chat / chatJSON runs.
 */
export function getProvider() {
  return governedProvider;
}
