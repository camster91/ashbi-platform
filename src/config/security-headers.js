function originFromDsn(dsn) {
  if (!dsn) return null;
  try { return new URL(dsn).origin; } catch { return null; }
}

export function buildHelmetOptions({ isProduction, corsOrigins = [], sentryDsn } = {}) {
  const connectSrc = ["'self'", 'wss:', 'https://fonts.googleapis.com', ...corsOrigins];
  const sentryOrigin = originFromDsn(sentryDsn);
  if (sentryOrigin) connectSrc.push(sentryOrigin);
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        blockAllMixedContent: isProduction ? [] : null,
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
        upgradeInsecureRequests: isProduction ? [] : null,
        workerSrc: ["'self'", 'blob:']
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    noSniff: true,
    originAgentCluster: true,
    referrerPolicy: { policy: 'no-referrer' },
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' }
  };
}

export const permissionsPolicy = [
  'camera=()', 'microphone=()', 'geolocation=()', 'payment=()',
  'usb=()', 'interest-cohort=()'
].join(', ');
