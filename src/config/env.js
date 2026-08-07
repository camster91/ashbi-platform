// Environment configuration

const env = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',

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
  aiModel: 'gemma4:31b',

  // Kilo AI (alternative AI gateway)
  kiloApiKey: process.env.KILO_API_KEY,
  kiloApiBase: process.env.KILO_API_BASE || 'https://api.kilo.ai/api/gateway/',
  kiloModel: process.env.KILO_MODEL || 'anthropic/claude-haiku-4-5',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Webhook
  webhookSecret: process.env.WEBHOOK_SECRET,
  notificationWebhookUrl: process.env.NOTIFICATION_WEBHOOK_URL,

  // Credentials vault encryption key
  credentialsKey: process.env.CREDENTIALS_KEY,

  // Observability
  // Sentry DSN for error tracking. Optional — if not set, Sentry.captureException
  // calls are no-ops. The src/index.js code path reads this directly.
  sentryDsn: process.env.SENTRY_DSN,

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

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

  // Shopify
  shopifyClientId: process.env.SHOPIFY_CLIENT_ID,
  shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  appUrl: process.env.APP_URL || 'https://hub.ashbi.ca',

  // Bot
  botSecret: process.env.BOT_SECRET,

  // WP Bridge
  wpBridgeSecret: process.env.WP_BRIDGE_SECRET,

  // Slack incoming webhook for the WP-bridge daily fleet digest.
  // Empty / unset disables the digest (the manual POST endpoint will
  // return 503 with code SLACK_WEBHOOK_MISSING).
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,

  // Notion
  // notionToken: process.env.NOTION_TOKEN,

  // Portal
  portalBaseUrl: process.env.PORTAL_BASE_URL || 'https://hub.ashbi.ca',

  // Hub URL (used for links in emails etc.)
  hubUrl: process.env.HUB_URL || 'https://hub.ashbi.ca',

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

// Validate required env vars in production
if (!env.isDev) {
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
    STRIPE_SECRET_KEY: 'your-stripe-secret-key',
    STRIPE_WEBHOOK_SECRET: 'your-stripe-webhook-secret',
    // PR-D: WP_BRIDGE_SECRET was previously accepted with the placeholder
    // value. The WordPress plugin uses the same secret to sign HMAC-SHA256
    // payloads, so a copy-paste deploy would authenticate against a
    // publicly-known shared secret. Refuse to start until it's replaced.
    WP_BRIDGE_SECRET: 'your-wp-bridge-shared-secret',
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
    ASHBI_WP_APP_PASSWORD: 'your-wordpress-app-password',
    NOTION_TOKEN: 'your-notion-integration-token',
  };
  const placeholderHits = Object.entries(placeholders)
    .filter(([key, placeholder]) => process.env[key] === placeholder)
    .map(([key]) => key);
  if (placeholderHits.length > 0) {
    throw new Error(
      `Refusing to start with placeholder env values: ${placeholderHits.join(', ')}. ` +
      `Replace these in your production env (see .env.example).`
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
  ];
  const missing = requiredInProduction.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`[env] Missing recommended environment variables in production: ${missing.join(', ')}`);
  }
}

export default env;
