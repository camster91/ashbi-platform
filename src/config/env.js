// @ts-check
// Environment configuration
import { parseTrustProxy } from './trust-proxy.js';

const trustProxyConfig = parseTrustProxy(process.env.TRUST_PROXY);

// NODE_ENV is an explicit allowlist. `development` and `test` are local
// environments that may start without deployment secrets; every other
// supported value is a deployed environment and is validated like
// production. An unrecognised value (a typo such as `prod`, or an ad-hoc
// name) fails closed rather than silently skipping secret validation.
// Unset means `development`, matching `npm run dev`.
export const LOCAL_NODE_ENVS = Object.freeze(['development', 'test']);
export const DEPLOYED_NODE_ENVS = Object.freeze(['staging', 'production']);
const nodeEnv = process.env.NODE_ENV || 'development';
if (!LOCAL_NODE_ENVS.includes(nodeEnv) && !DEPLOYED_NODE_ENVS.includes(nodeEnv)) {
  throw new Error(
    `Unsupported NODE_ENV "${nodeEnv}". Set NODE_ENV to one of: ` +
    `${[...LOCAL_NODE_ENVS, ...DEPLOYED_NODE_ENVS].join(', ')}.`
  );
}
const isDevelopment = nodeEnv === 'development';
const isTest = nodeEnv === 'test';

const env = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isDevelopment,
  isTest,
  isStaging: nodeEnv === 'staging',
  isProduction: nodeEnv === 'production',
  // staging or production. Security behaviour (secret validation, secure
  // cookies, HSTS, generic 5xx bodies, fail-closed webhooks and admin
  // bootstrap, fixed rate limit) keys off this, so staging matches
  // production. isProduction is only for production-specific concerns.
  isDeployed: nodeEnv === 'staging' || nodeEnv === 'production',
  // True only for the local environments (development, test).
  isDev: isDevelopment || isTest,
  // Whether deployment secrets are validated at startup.
  requiresDeploymentSecrets: !(isDevelopment || isTest),
  // Serve the built SPA (dist/) from Fastify. Always on in production; the
  // full-stack E2E stack opts in with SERVE_BUILT_SPA=true so browser journeys
  // run against the real API origin without a Vite dev server.
  serveBuiltSpa: process.env.NODE_ENV === 'production' || process.env.SERVE_BUILT_SPA === 'true',
  // Reverse-proxy hops to trust for request.ip (src/config/trust-proxy.js).
  // Off unless TRUST_PROXY is set; 1 for the Traefik deployment.
  trustProxy: trustProxyConfig.trustProxy,
  trustProxyInvalid: trustProxyConfig.invalid,

  // CORS - supports multiple origins separated by commas
  corsOrigins: (process.env.CORS_ORIGIN || 'https://hub.ashbi.ca')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  adminInviteToken: process.env.ADMIN_INVITE_TOKEN, // Required for first admin registration

  // AI
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  ollamaApiKey: process.env.OLLAMA_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma4:31b',
  aiProvider: process.env.AI_PROVIDER || 'ollama', // 'claude', 'gemini', or 'ollama'
  // The AI provider is one process-wide setting shared by every organization,
  // so only these deployment operators (user ids, which cannot be claimed by
  // registering a look-alike email) may switch it at runtime.
  platformOperatorUserIds: (process.env.PLATFORM_OPERATOR_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  aiModel: 'gemma4:31b',
  // The anonymous booking page (/portal/book) books into one organization's
  // calendar. Unset, booking works only while the deployment has exactly one
  // organization; with more, it is disabled until this is configured.
  publicBookingOrganizationId: process.env.PUBLIC_BOOKING_ORGANIZATION_ID?.trim() || null,

  // Kilo AI (alternative AI gateway)
  kiloApiKey: process.env.KILO_API_KEY,
  kiloApiBase: process.env.KILO_API_BASE || 'https://api.kilo.ai/api/gateway/',
  kiloModel: process.env.KILO_MODEL || 'anthropic/claude-haiku-4-5',

  // WebRTC: JSON array of RTCIceServer objects (add a TURN relay here)
  webrtcIceServers: process.env.WEBRTC_ICE_SERVERS,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Webhook
  webhookSecret: process.env.WEBHOOK_SECRET,
  notificationWebhookUrl: process.env.NOTIFICATION_WEBHOOK_URL,

  // VAPID keys for Web Push notifications. The env-var pair is the primary
  // production path; the path is the fallback for file-based persistence.
  // (See utils/web-push.js for the priority order.)
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidKeysPath: process.env.VAPID_KEYS_PATH,

  // Contract signing secret. Falls back to JWT_SECRET so a single env var
  // covers both, but a dedicated value is recommended in production so the
  // contract signing material can be rotated independently of session JWTs.
  contractSignatureSecret: process.env.CONTRACT_SIGNATURE_SECRET || process.env.JWT_SECRET,

  // Gmail OAuth token storage. GMAIL_TOKENS_JSON (inline JSON) wins over
  // GMAIL_TOKENS_PATH (filesystem path) so the secrets can be injected via
  // the orchestrator without a volume mount.
  gmailTokensPath: process.env.GMAIL_TOKENS_PATH,
  gmailTokensJson: process.env.GMAIL_TOKENS_JSON,

  // Credentials vault encryption key
  credentialsKey: process.env.CREDENTIALS_KEY,
  credentialsKeyring: process.env.CREDENTIALS_KEYRING,
  credentialsActiveKeyVersion: process.env.CREDENTIALS_ACTIVE_KEY_VERSION || 'legacy',
  credentialsKeyOwner: process.env.CREDENTIALS_KEY_OWNER,

  // Observability
  // Sentry DSN for error tracking. Optional — if not set, Sentry.captureException
  // calls are no-ops. The src/index.js code path reads this directly.
  sentryDsn: process.env.SENTRY_DSN,
  otlpEndpoint: process.env.OTLP_ENDPOINT,
  observabilityOwner: process.env.OBSERVABILITY_OWNER,

  // Hermes webhook signature secret. Required for verifying inbound webhooks
  // from the Hermes notification system. If unset in production, the webhook
  // endpoint will reject all requests (returns 503).
  hermesWebhookSecret: process.env.HERMES_WEBHOOK_SECRET,

  // Hermes bridge enablement (set to 'false' in .env to turn off the
  // hub-hermes integration entirely). Defaults to enabled.
  hermesBridgeEnabled: process.env.HERMES_BRIDGE_ENABLED,

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ashbi',

  // Integrations
  coolifyUrl: process.env.COOLIFY_URL || null,
  coolifyToken: process.env.COOLIFY_TOKEN,
  githubToken: process.env.GITHUB_TOKEN,
  githubOrg: process.env.GITHUB_ORG || 'camster91',
  hostingerAshbiSites: process.env.HOSTINGER_ASHBI_SITES || '',
  hostingerInfluencerStores: process.env.HOSTINGER_INFLUENCER_STORES || '',

  // Mailgun
  mailgunApiKey: process.env.MAILGUN_API_KEY,
  mailgunDomain: process.env.MAILGUN_DOMAIN || 'ashbi.ca',
  mailgunSigningKey: process.env.MAILGUN_SIGNING_KEY,
  // HTTP webhook signing key (Mailgun → Sending → Webhooks) for delivery events.
  mailgunWebhookSigningKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY,
  // Where human-in-the-loop (HITL) task / approval emails are sent. Unset
  // means no HITL email is sent. Replies are accepted only from the Hub user
  // the notification was created for, or an active admin of that user's org.
  hitlApproverEmail: process.env.HITL_APPROVER_EMAIL?.trim() || null,
  // Key material for HITL reply addresses (reply+<id>.<token>@...). Falls
  // back to JWT_SECRET (a derived key is used either way); set it to rotate
  // reply addresses independently of sessions. Rotating invalidates replies
  // to emails already sent.
  hitlReplySecret: process.env.HITL_REPLY_SECRET || null,
  // Local development only: accept unsigned POST /api/mailgun when
  // MAILGUN_SIGNING_KEY is unset. Honoured only with NODE_ENV=development.
  mailgunAllowUnsignedInbound: process.env.MAILGUN_ALLOW_UNSIGNED_INBOUND === '1',

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

  // Shopify
  shopifyClientId: process.env.SHOPIFY_CLIENT_ID,
  shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  appUrl: process.env.APP_URL || 'https://hub.ashbi.ca',

  // Bot
  botSecret: process.env.BOT_SECRET,
  botOrganizationId: process.env.BOT_ORGANIZATION_ID,

  // Slack Events API signing secret. The event route fails closed while this
  // is absent; it is intentionally distinct from an outgoing webhook URL.
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  slackClientId: process.env.SLACK_CLIENT_ID,
  slackClientSecret: process.env.SLACK_CLIENT_SECRET,
  slackRedirectUri: process.env.SLACK_REDIRECT_URI || `${process.env.HUB_URL || 'https://hub.ashbi.ca'}/api/slack/oauth/callback`,

  // Google Calendar OAuth. Per-user refresh tokens are encrypted in the
  // database rather than configured in the environment.
  googleCalendarClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  googleCalendarClientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  googleCalendarRedirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.HUB_URL || 'https://hub.ashbi.ca'}/api/google-calendar/oauth/callback`,

  // Notion
  // notionToken: process.env.NOTION_TOKEN,

  // Portal
  portalBaseUrl: process.env.PORTAL_BASE_URL || 'https://hub.ashbi.ca',

  // Hub URL (used for links in emails etc.)
  hubUrl: process.env.HUB_URL || 'https://hub.ashbi.ca',

  // Web page review capture (docs/media-review.md "Web page review"): off
  // unless explicitly enabled, because it runs a headless browser on the API
  // host. WEB_REVIEW_CHROMIUM_PATH points at the Chromium executable when the
  // browser is not the one bundled for playwright-core (e.g. Alpine's
  // `chromium` package).
  webReviewCaptureEnabled: process.env.WEB_REVIEW_CAPTURE_ENABLED === 'true',
  webReviewChromiumPath: process.env.WEB_REVIEW_CHROMIUM_PATH || undefined,

  // OpenClaw (ops integration)
  openclawUrl: process.env.OPENCLAW_URL || 'http://localhost:3000',
  openclawApiKey: process.env.OPENCLAW_API_KEY,

  // Match confidence thresholds
  autoMatchThreshold: 0.85,
  suggestMatchThreshold: 0.5,

  // SLA defaults (in hours)
  slaDefaults: {
    CRITICAL: 2,
    HIGH: 4,
    NORMAL: 24,
    LOW: 72
  }
};

// Validate required env vars in every deployed environment (staging and
// production). Only explicit `development` and `test` skip this.
if (env.requiresDeploymentSecrets) {
  // Critical secrets — app must not start without these
  const critical = ['JWT_SECRET', 'CREDENTIALS_KEY'];
  const missingCritical = critical.filter(key => !process.env[key]);
  if (missingCritical.length > 0) {
    throw new Error(`Missing critical environment variables: ${missingCritical.join(', ')}`);
  }

  // Reject placeholder values that ship in .env.example — a copy-paste deploy
  // would otherwise start with a known-secret JWT or placeholder API key.
  // The previous check only validated 2 secrets; copy-paste deploys could
  // silently ship with placeholder values for STRIPE_*, MAILGUN_*, etc.
  const placeholders = {
    JWT_SECRET: 'your-secret-key-change-in-production',
    CREDENTIALS_KEY: 'your-credentials-key-change-in-production',
    ADMIN_INVITE_TOKEN: 'your-admin-invite-token',
    WEBHOOK_SECRET: 'your-webhook-secret',
    HERMES_WEBHOOK_SECRET: 'your-hermes-webhook-secret',
    MAILGUN_API_KEY: 'your-mailgun-api-key',
    MAILGUN_SIGNING_KEY: 'your-mailgun-signing-key',
    MAILGUN_WEBHOOK_SIGNING_KEY: 'your-mailgun-webhook-signing-key',
    STRIPE_SECRET_KEY: 'your-stripe-secret-key',
    STRIPE_WEBHOOK_SECRET: 'your-stripe-webhook-secret',
    BOT_SECRET: 'your-bot-secret',
    COOLIFY_TOKEN: 'your-coolify-api-token',
    SHOPIFY_CLIENT_SECRET: 'your-shopify-client-secret',
    GITHUB_TOKEN: 'your-github-personal-access-token',
    KILO_API_KEY: 'your-kilo-api-key',
    ANTHROPIC_API_KEY: 'your-anthropic-api-key',
    GEMINI_API_KEY: 'your-gemini-api-key',
    OLLAMA_API_KEY: 'your-ollama-cloud-api-key',
    OPENCLAW_API_KEY: 'your-openclaw-api-key',
    HUNTER_API_KEY: 'your-hunter-api-key',
    NOTION_TOKEN: 'your-notion-integration-token',
  };
  // HITL reply addresses are HMAC tokens; a short dedicated key would make
  // them guessable. Unset is fine (a key derived from JWT_SECRET is used).
  if (process.env.HITL_REPLY_SECRET && Buffer.byteLength(process.env.HITL_REPLY_SECRET) < 32) {
    throw new Error('HITL_REPLY_SECRET must be at least 32 bytes when set (or leave it unset to derive the key from JWT_SECRET)');
  }

  const placeholderHits = Object.entries(placeholders)
    .filter(([key, placeholder]) => process.env[key] === placeholder)
    .map(([key]) => key);
  if (placeholderHits.length > 0) {
    throw new Error(
      `Refusing to start with placeholder env values: ${placeholderHits.join(', ')}. ` +
      `Replace these in your ${env.nodeEnv} env (see .env.example).`
    );
  }

  // Required in production — log warning but allow degraded startup
  const requiredInProduction = [
    'WEBHOOK_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'MAILGUN_API_KEY',
    'MAILGUN_SIGNING_KEY',
    'COOLIFY_URL',
    'OBSERVABILITY_OWNER',
    'CREDENTIALS_KEY_OWNER',
  ];
  const missing = requiredInProduction.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`[env] Missing recommended environment variables in ${env.nodeEnv}: ${missing.join(', ')}`);
  }
}

export default env;
