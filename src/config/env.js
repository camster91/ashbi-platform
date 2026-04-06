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
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: '7d',

  // AI
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  ollamaApiKey: process.env.OLLAMA_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma4:31b',
  aiProvider: process.env.AI_PROVIDER || 'ollama', // 'claude', 'gemini', or 'ollama'
  aiModel: 'gemma4:31b',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Webhook
  webhookSecret: process.env.WEBHOOK_SECRET,

  // Credentials vault encryption key
  credentialsKey: process.env.CREDENTIALS_KEY || 'dev-credentials-key-change-in-production',

  // Integrations
  coolifyUrl: process.env.COOLIFY_URL || 'http://187.77.26.99:8000',
  coolifyToken: process.env.COOLIFY_TOKEN,
  githubToken: process.env.GITHUB_TOKEN,
  githubOrg: process.env.GITHUB_ORG || 'camster91',
  hostingerAshbiSites: process.env.HOSTINGER_ASHBI_SITES || '',
  hostingerInfluencerStores: process.env.HOSTINGER_INFLUENCER_STORES || '',

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
  const required = ['JWT_SECRET', 'WEBHOOK_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export default env;
