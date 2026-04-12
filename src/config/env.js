// Environment configuration

const env = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // CORS - supports multiple origins separated by commas
  corsOrigins: (process.env.CORS_ORIGIN || 'https://hub.ashbi.ca')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '7d',

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

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ashbi',

  // Integrations
  coolifyUrl: process.env.COOLIFY_URL || 'http://187.77.26.99:8000',
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

  // Notion
  notionToken: process.env.NOTION_TOKEN,

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

  // Required in production — log warning but allow degraded startup
  const requiredInProduction = [
    'WEBHOOK_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'MAILGUN_API_KEY',
    'MAILGUN_SIGNING_KEY',
  ];
  const missing = requiredInProduction.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`[env] Missing recommended environment variables in production: ${missing.join(', ')}`);
  }
}

export default env;
