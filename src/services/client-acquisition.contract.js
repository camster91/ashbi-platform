// Governed public inquiry contract for ashbi.ca (issue #426).
//
// ashbi.ca stays the public marketing site; the Hub only accepts and records
// inquiries. Accepting an inquiry never creates a client, proposal, invoice,
// payment, booking, or outbound message.

import crypto from 'node:crypto';
import { z } from 'zod';

// Enumerations shared with ashbi-redesign/src/lib/hub-inquiry-contract.ts.
// Keep these in lockstep with that file; a mismatch rejects real inquiries.
export const TIMING_OPTIONS = Object.freeze(['asap', '1-3-months', '3-6-months', 'exploring']);
export const BUDGET_BANDS = Object.freeze(['under-5k', '5k-15k', '15k-50k', '50k-plus', 'not-sure']);
export const BUDGET_CURRENCIES = Object.freeze(['CAD', 'USD']);
// A band without an amount does not need a currency.
const CURRENCYLESS_BUDGET_BANDS = new Set(['not-sure']);

export const INTAKE_BODY_LIMIT_BYTES = 16 * 1024;

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Read the intake gate from the environment. Intake is enabled only when every
 * setting is present; anything missing fails closed.
 */
export function loadClientAcquisitionConfig(source = process.env) {
  const config = {
    organizationId: source.CLIENT_ACQUISITION_ORGANIZATION_ID?.trim() || null,
    ownerId: source.CLIENT_ACQUISITION_OWNER_ID?.trim() || null,
    privacyVersion: source.CLIENT_ACQUISITION_PRIVACY_VERSION?.trim() || null,
    serviceLines: splitList(source.CLIENT_ACQUISITION_SERVICE_LINES),
    allowedOrigins: splitList(source.CLIENT_ACQUISITION_ALLOWED_ORIGINS),
  };
  config.enabled = Boolean(
    config.organizationId &&
    config.ownerId &&
    config.privacyVersion &&
    config.serviceLines.length > 0 &&
    config.allowedOrigins.length > 0
  );
  return Object.freeze(config);
}

/** The only fields ashbi.ca may see. Never add identifiers or contacts here. */
export function publicConfig(config) {
  if (!config.enabled) return { enabled: false, privacyVersion: null, serviceLines: [] };
  return { enabled: true, privacyVersion: config.privacyVersion, serviceLines: [...config.serviceLines] };
}

/** CORS for the public endpoints: approved origins only, never credentials. */
export function clientAcquisitionCorsOptions(config) {
  return {
    origin: config.enabled ? [...config.allowedOrigins] : false,
    credentials: false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  };
}

// Tab, LF and CR are kept; other C0 controls and DEL are dropped.
function stripControlCharacters(value) {
  return [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('');
}

// Strip control characters and trim; collapse nothing else so the stored text
// matches what the visitor wrote.
const text = (max) => z.string()
  .transform((value) => stripControlCharacters(value).trim())
  .pipe(z.string().min(1).max(max));
const optionalText = (max) => z.union([z.literal(''), z.null(), text(max)]).optional()
  .transform((value) => (value ? value : null));
const token = z.string().trim().max(100).regex(/^[\w .:+-]*$/, 'Unsupported characters');

function sanitizeUrl(value, { keepQuery }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  if (!keepQuery) url.search = '';
  return url.toString();
}

const attributionSchema = z.object({
  landingPage: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  source: token.optional(),
  medium: token.optional(),
  campaign: token.optional(),
  clickId: z.string().trim().max(200).regex(/^[\w.-]*$/, 'Unsupported characters').optional(),
}).strict().transform((value, ctx) => {
  const result = {};
  for (const key of ['landingPage', 'referrer']) {
    if (!value[key]) continue;
    // Referrers can carry third-party query strings (tokens, emails). Keep only
    // origin + path; the landing page keeps its own campaign query.
    const cleaned = sanitizeUrl(value[key], { keepQuery: key === 'landingPage' });
    if (!cleaned) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Must be an http(s) URL' });
      return z.NEVER;
    }
    result[key] = cleaned;
  }
  for (const key of ['source', 'medium', 'campaign', 'clickId']) {
    if (value[key]) result[key] = value[key];
  }
  return result;
});

export const intakeSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(128).regex(/^[\w-]+$/, 'Unsupported characters'),
  name: text(200),
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  company: optionalText(200),
  phone: z.union([z.literal(''), z.null(), z.string().trim().max(40).regex(/^[\d\s()+.-]{5,40}$/, 'Invalid phone')])
    .optional().transform((value) => (value ? value : null)),
  serviceLine: z.string().trim().min(1).max(100),
  businessContext: text(5000),
  requestedOutcome: text(5000),
  timing: z.enum(TIMING_OPTIONS).nullable().optional().transform((value) => value ?? null),
  budgetBand: z.enum(BUDGET_BANDS).nullable().optional().transform((value) => value ?? null),
  budgetCurrency: z.enum(BUDGET_CURRENCIES).nullable().optional().transform((value) => value ?? null),
  consent: z.literal(true),
  privacyVersion: z.string().trim().min(1).max(100),
  attribution: attributionSchema.optional().transform((value) => value ?? {}),
  // Honeypot. Humans never see this field, so any value marks automation.
  website: z.string().max(500).optional(),
}).strict().superRefine((value, ctx) => {
  const needsCurrency = value.budgetBand && !CURRENCYLESS_BUDGET_BANDS.has(value.budgetBand);
  if (needsCurrency && !value.budgetCurrency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['budgetCurrency'], message: 'Required for this budget band' });
  }
  if (!needsCurrency && value.budgetCurrency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['budgetCurrency'], message: 'Only allowed with a budget amount' });
  }
});

/**
 * Hash of the fields that define "the same inquiry". A retry with the same
 * idempotency key must match this exactly; anything else is a conflict.
 */
export function canonicalPayloadHash(inquiry) {
  const canonical = {
    name: inquiry.name,
    email: inquiry.email,
    company: inquiry.company,
    phone: inquiry.phone,
    serviceLine: inquiry.serviceLine,
    businessContext: inquiry.businessContext,
    requestedOutcome: inquiry.requestedOutcome,
    timing: inquiry.timing,
    budgetBand: inquiry.budgetBand,
    budgetCurrency: inquiry.budgetCurrency,
    privacyVersion: inquiry.privacyVersion,
    attribution: Object.fromEntries(Object.entries(inquiry.attribution || {}).sort(([a], [b]) => a.localeCompare(b))),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
