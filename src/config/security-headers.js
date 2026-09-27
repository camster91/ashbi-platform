function originFromDsn(dsn) {
  if (!dsn) return null;
  try { return new URL(dsn).origin; } catch { return null; }
}

// `isDeployed` (staging or production, from env.js) enables HSTS and
// upgrade-insecure-requests; `isProduction` is accepted for older callers.
export function buildHelmetOptions({ isProduction, isDeployed = isProduction, corsOrigins = [], sentryDsn } = {}) {
  const connectSrc = ["'self'", 'wss:', 'https://fonts.googleapis.com', ...corsOrigins];
  const sentryOrigin = originFromDsn(sentryDsn);
  if (sentryOrigin) connectSrc.push(sentryOrigin);
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        blockAllMixedContent: isDeployed ? [] : null,
        connectSrc: [...new Set(connectSrc)],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        frameSrc: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        upgradeInsecureRequests: isDeployed ? [] : null,
        workerSrc: ["'self'", 'blob:']
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    hsts: isDeployed ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    noSniff: true,
    originAgentCluster: true,
    referrerPolicy: { policy: 'no-referrer' },
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' }
  };
}

export const permissionsPolicy = [
  // Project calls and screen recordings use browser permission prompts. Keep
  // the capability first-party only; embedded third-party frames remain denied.
  'camera=(self)', 'microphone=(self)', 'display-capture=(self)', 'geolocation=()', 'payment=()',
  'usb=()', 'interest-cohort=()'
].join(', ');
