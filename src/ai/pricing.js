// Per-model price table for BYOK cost estimates (#413, docs/ai-byok.md).
//
// Prices are operator configuration, not code: vendor prices change and an
// out-of-date built-in table would silently mis-state spend. Set
// AI_MODEL_PRICES to a JSON object keyed by model id, with US cents per one
// million tokens:
//
//   AI_MODEL_PRICES='{"example-model":{"input":15,"output":60}}'
//
// A model without a price records its tokens with estimatedCostCents = null;
// such usage does not count toward the monthly budget (the settings page shows
// it as unpriced so an admin can see the gap).

const TOKENS_PER_UNIT = 1_000_000;

let cachedRaw;
let cachedTable = Object.freeze({});

function isPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Parse a price table. Invalid entries are skipped; an unparsable value yields
 * an empty table rather than failing every AI call.
 * @param {string | undefined} raw
 * @returns {Readonly<Record<string, { input: number, output: number }>>}
 */
export function parseModelPrices(raw) {
  if (!raw) return Object.freeze({});
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Object.freeze({});
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.freeze({});
  /** @type {Record<string, { input: number, output: number }>} */
  const table = {};
  for (const [model, price] of Object.entries(parsed)) {
    if (price && isPrice(price.input) && isPrice(price.output)) table[model] = { input: price.input, output: price.output };
  }
  return Object.freeze(table);
}

/** The configured table, re-read when AI_MODEL_PRICES changes. */
export function getModelPrices() {
  const raw = process.env.AI_MODEL_PRICES;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTable = parseModelPrices(raw);
  }
  return cachedTable;
}

/**
 * Estimated cost in US cents, or null when the model has no configured price.
 * @param {string} model
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @param {Readonly<Record<string, { input: number, output: number }>>} [prices]
 */
export function estimateCostCents(model, promptTokens, completionTokens, prices = getModelPrices()) {
  const price = Object.prototype.hasOwnProperty.call(prices, model) ? prices[model] : null;
  if (!price) return null;
  const cents = (promptTokens * price.input + completionTokens * price.output) / TOKENS_PER_UNIT;
  return Math.round(cents * 10_000) / 10_000;
}
