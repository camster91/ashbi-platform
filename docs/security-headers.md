# Security header policy

`src/config/security-headers.js` is the authoritative application policy.
Fastify registers it before application routes, and unit tests inject a real
response through `@fastify/helmet` instead of merely checking configuration
text.

The CSP permits same-origin scripts, API/WebSocket connections, images/media,
the configured CORS origins, Sentry ingestion, and Google Fonts. Frames,
objects, script attributes, and `unsafe-eval` are denied. Existing React
surfaces use many inline `style` attributes, so `style-src 'unsafe-inline'` is
the one documented temporary exception. Removing it requires migrating those
attributes to classes or nonce-compatible styles; it does not permit inline
scripts.

HSTS and mixed-content upgrading are production-only so localhost development
is not forced onto TLS. TLS termination proxies must preserve these application
headers rather than replacing them with a weaker policy.

Before closing issue #140:

1. Deploy to staging and inspect the effective headers through the public
   proxy, not only the container port.
2. Exercise login, authenticated navigation, client proposal/contract/invoice
   portals, Stripe payment links, uploaded-file downloads, WebSockets, fonts,
   and Sentry reporting.
3. Capture browser console CSP violations and approve only origins required by
   a documented feature. Do not add broad `*`, `unsafe-eval`, or inline-script
   exceptions.
4. Repeat `curl -I` against production after promotion and attach the evidence
   to #140.
