/**
 * API access matrix (#412).
 *
 * Builds the real application (the same way route-table.test.js does), records
 * every route through an `onRoute` hook attached as the Fastify instance is
 * created, and classifies each route by the auth guard in its effective
 * request lifecycle (route options plus hooks inherited from its plugin).
 * Guards are recognised by function identity against the root decorators
 * (`fastify.authenticate`, `fastify.adminOnly`, `fastify.authenticateWithApiKey`)
 * and by name for the two plugin-local guards (`clientAuth`, `requireBotAuth`).
 *
 * The rendered table is committed as docs/api-access-matrix.md. This test fails
 * when it drifts; regenerate with:
 *
 *   UPDATE_ACCESS_MATRIX=1 npm test
 *
 * It also fails when a route has no guard and is not listed in
 * INTENTIONALLY_PUBLIC_ROUTES below with a reason, or when an allowlist entry
 * no longer matches an unguarded route.
 */
import assert from 'node:assert/strict';
import diagnosticsChannel from 'node:diagnostics_channel';
import fs from 'node:fs';
import test from 'node:test';
import { isTenancyExemptUrl } from '../../middleware/tenancy.js';

const DOC_URL = new URL('../../../docs/api-access-matrix.md', import.meta.url);

const LIFECYCLE_HOOKS = ['onRequest', 'preParsing', 'preValidation', 'preHandler'];

/**
 * Routes that deliberately carry no auth hook. Each one authenticates by other
 * means (credential exchange, signed webhook, capability token in the URL,
 * signed OAuth state) or is intentionally anonymous. Adding a route here is a
 * security decision: give the reason, and prefer adding a guard instead.
 *
 * @type {Record<string, { category: string, reason: string }>}
 */
const INTENTIONALLY_PUBLIC_ROUTES = {
  'OPTIONS *': { category: 'infrastructure', reason: 'CORS preflight handled by @fastify/cors.' },
  'GET /api/live': { category: 'health', reason: 'Liveness probe; returns only status and revision.' },
  'GET /api/health': { category: 'health', reason: 'Readiness probe for the deploy controller and uptime checks.' },

  'POST /api/auth/login': { category: 'credential exchange', reason: 'Staff password login.' },
  'POST /api/auth/login/mfa': { category: 'credential exchange', reason: 'Second login step; requires the short-lived MFA challenge token.' },
  'POST /api/auth/logout': { category: 'credential exchange', reason: 'Verifies the session cookie in the handler when present; always clears it.' },
  'POST /api/auth/register': { category: 'credential exchange', reason: 'First-admin bootstrap gated by ADMIN_INVITE_TOKEN; later registrations require an admin session checked in the handler.' },
  'POST /api/auth/forgot-password': { category: 'credential exchange', reason: 'Issues a reset email; response does not reveal whether the account exists.' },
  'POST /api/auth/reset-password': { category: 'credential exchange', reason: 'Requires the emailed single-use reset token.' },
  'POST /api/auth/client/signup': { category: 'credential exchange', reason: 'Requires a client invitation token.' },
  'POST /api/auth/client/login': { category: 'credential exchange', reason: 'Client portal password login.' },
  'POST /api/bot/auth': { category: 'credential exchange', reason: 'Checks the bot bearer secret in the handler before issuing a JWT.' },

  'POST /api/client-portal/request-access': { category: 'magic link', reason: 'Emails a client portal magic link.' },
  'POST /api/client-portal/verify-token': { category: 'magic link', reason: 'Exchanges the emailed magic-link token for a portal session cookie.' },

  'GET /api/portal/:token': { category: 'capability token', reason: 'Project status page addressed by an unguessable project viewToken.' },
  'GET /api/portal/proposal/:viewToken': { category: 'capability token', reason: 'Proposal view link.' },
  'POST /api/portal/proposal/:viewToken/approve': { category: 'capability token', reason: 'Proposal approval via view link.' },
  'POST /api/portal/proposal/:viewToken/decline': { category: 'capability token', reason: 'Proposal decline via view link.' },
  'GET /api/portal/contract/:signToken': { category: 'capability token', reason: 'Contract signing link.' },
  'POST /api/portal/contract/:signToken/sign': { category: 'capability token', reason: 'Contract signature via signing link.' },
  'GET /api/portal/invoice/:viewToken': { category: 'capability token', reason: 'Invoice view link.' },
  'POST /api/portal/invoice/:viewToken/pay': { category: 'capability token', reason: 'Starts checkout for the invoice behind the view link.' },
  'GET /api/portal/form/:viewToken': { category: 'capability token', reason: 'Client form link.' },
  'POST /api/portal/form/:viewToken': { category: 'capability token', reason: 'Client form submission via form link.' },
  'GET /api/invoices/client/:viewToken': { category: 'capability token', reason: 'Invoice view link (legacy path).' },
  'GET /api/contracts/sign/:signToken': { category: 'capability token', reason: 'Contract signing link (legacy path).' },
  'POST /api/contracts/sign/:signToken': { category: 'capability token', reason: 'Contract signature (legacy path).' },
  'GET /api/proposals/client/:viewToken': { category: 'capability token', reason: 'Proposal view link (legacy path).' },
  'POST /api/proposals/client/:viewToken/approve': { category: 'capability token', reason: 'Proposal approval (legacy path).' },
  'POST /api/proposals/client/:viewToken/decline': { category: 'capability token', reason: 'Proposal decline (legacy path).' },
  'GET /api/estimates/view/:viewToken': { category: 'capability token', reason: 'Estimate view link.' },
  'POST /api/estimates/view/:viewToken/approve': { category: 'capability token', reason: 'Estimate approval via view link.' },

  'POST /api/invoices/stripe-webhook': { category: 'signed webhook', reason: 'Stripe-Signature verified in the handler.' },
  'POST /api/webhooks/stripe': { category: 'signed webhook', reason: 'Stripe-Signature verified in the handler.' },
  'POST /api/webhooks/email': { category: 'signed webhook', reason: 'Inbound email webhook; signature verified in the handler.' },
  'POST /api/mailgun': { category: 'signed webhook', reason: 'Mailgun HMAC signature verified in the handler (fails closed outside dev).' },
  'POST /api/mailgun/events': { category: 'signed webhook', reason: 'Mailgun HMAC signature and single-use token verified in the handler.' },
  'POST /api/mailgun-hitl/hitl-reply': { category: 'signed webhook', reason: 'Mailgun HMAC signature verified in the handler; always answers 200.' },
  'POST /api/slack/events': { category: 'signed webhook', reason: 'Slack request signature verified before the body is trusted.' },
  'GET /api/slack/oauth/callback': { category: 'oauth callback', reason: 'OAuth state is a signed JWT verified in the handler.' },
  'GET /api/google-calendar/oauth/callback': { category: 'oauth callback', reason: 'OAuth state is a signed JWT verified in the handler. Not tenancy-exempt, so the tenant guard also requires the staff session cookie.' },

  'GET /api/client-acquisition/config': { category: 'public intake', reason: 'Public ashbi.ca inquiry form configuration; own CORS allowlist, no cookies.' },
  'POST /api/client-acquisition/intake': { category: 'public intake', reason: 'Public ashbi.ca inquiry submission; own CORS allowlist, no cookies.' },
  'GET /api/webhooks/email/status': { category: 'health', reason: 'Static liveness response for the email webhook; reads no data.' },
  'GET /api/portal/booking/availability': { category: 'public intake', reason: 'Public booking page availability; returns free/busy slots for the one booking organization only.' },
  'POST /api/portal/booking': { category: 'public intake', reason: 'Public booking page submission; books into the one booking organization only.' },
};

/**
 * Signed-in routes under a tenancy-exempt prefix (see `isTenancyExemptUrl` in
 * src/middleware/tenancy.js). They get the raw, unscoped Prisma client, so each
 * handler must confine its own queries. Routes guarded by the client portal or
 * bot secret are not listed: those guards scope every query themselves (by
 * clientId, or by the bot organization). Adding a route here is a security
 * review: state how the handler stays inside the caller's tenant.
 *
 * @type {Record<string, string>}
 */
const REVIEWED_UNSCOPED_ROUTES = {
  'GET /api/auth/me': 'Reads and returns only the caller\'s own user record.',
  'PUT /api/auth/me': 'Updates only the caller\'s own user record.',
  'POST /api/auth/change-password': 'Changes only the caller\'s own password.',
  'GET /api/auth/mfa': 'Reads only the caller\'s own two-factor state.',
  'POST /api/auth/mfa/enroll': 'Writes only the caller\'s own two-factor state.',
  'POST /api/auth/mfa/confirm': 'Writes only the caller\'s own two-factor state.',
  'POST /api/auth/mfa/disable': 'Writes only the caller\'s own two-factor state.',
  'POST /api/auth/reauth': 'Verifies only the caller\'s own password or second factor and writes only the caller\'s own MFA attempt state.',
  'POST /api/auth/mfa/admin/users/:userId/reset': 'Admin only; the target user is looked up with the admin\'s organizationId.',
  'POST /api/auth/admin/clients/:clientId/invite': 'Admin only; the client is looked up with the admin\'s organizationId.',
  'POST /api/mailgun/send': 'Admin only; sends one email and reads no tenant data.',
  'POST /api/webhooks/email/test': 'Admin only; runs the email pipeline inside the admin\'s organization via runTenantJob.',
};

const SELF_SCOPING_GUARDS = new Set(['client-portal', 'bot-secret']);

/**
 * Build the application and return every registered route together with the
 * guards in its effective request lifecycle.
 *
 * @returns {Promise<Array<{ method: string, url: string, guards: string[], tenancy: 'exempt' | 'scoped' }>>}
 */
async function collectAccessMatrix() {
  /** @type {Array<{ url: string, methods: string[], opts: any, instance: any }>} */
  const recorded = [];
  const onInit = ({ fastify }) => {
    fastify.addHook('onRoute', function recordRoute(opts) {
      // Fastify reuses and mutates `opts` for a prefix root's trailing-slash
      // alias, so copy the URL and methods now.
      recorded.push({ url: opts.url, methods: [].concat(opts.method), opts, instance: this });
    });
  };
  diagnosticsChannel.subscribe('fastify.initialization', onInit);
  const { buildApp } = await import('../../index.js');
  let app;
  try {
    app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  } finally {
    diagnosticsChannel.unsubscribe('fastify.initialization', onInit);
  }
  try {
    await app.ready();
    const kHooks = Object.getOwnPropertySymbols(app).find((symbol) => symbol.description === 'fastify.hooks');
    assert.ok(kHooks, 'Fastify internal hooks symbol not found; the access matrix needs updating for this Fastify version');

    const identityGuards = new Map([
      [app.adminOnly, 'admin'],
      [app.authenticate, 'staff'],
      [app.authenticateWithApiKey, 'api-key'],
    ]);
    const namedGuards = new Map([
      ['clientAuth', 'client-portal'],
      ['requireBotAuth', 'bot-secret'],
      // Additional checks, not authentication by themselves (see the test
      // that requires a session or API-key guard alongside them).
      ['requireRecentAuth', 'recent-auth'],
      ['requireRecentAuthForAccessChange', 'recent-auth (access change)'],
    ]);

    /** @param {Function} fn */
    const classify = (fn) => {
      if (identityGuards.has(fn)) return identityGuards.get(fn);
      if (namedGuards.has(fn.name)) return namedGuards.get(fn.name);
      if (typeof (/** @type {any} */ (fn).apiKeyScope) === 'string') return `scope ${/** @type {any} */ (fn).apiKeyScope}`;
      const source = Function.prototype.toString.call(fn);
      if (/fastify\.adminOnly\(/.test(source)) return 'admin (inline)';
      if (/fastify\.authenticate\(/.test(source)) return 'staff (inline)';
      return null;
    };

    const routes = [];
    for (const { url, methods, opts, instance } of recorded) {
      const hooks = LIFECYCLE_HOOKS.flatMap((name) => [
        ...(instance[kHooks][name] ?? []),
        ...[].concat(opts[name] ?? []),
      ]);
      const guards = [...new Set(hooks.map(classify).filter(Boolean))].sort();
      for (const method of methods) {
        routes.push({ method, url, guards, tenancy: isTenancyExemptUrl(url) ? 'exempt' : 'scoped' });
      }
    }

    // HEAD routes Fastify derives from GET routes share the GET lifecycle.
    // Compare without a trailing slash: the HEAD twin of a prefix root is
    // recorded under its trailing-slash alias.
    const bare = (url) => (url.length > 1 ? url.replace(/\/$/, '') : url);
    const getUrls = new Set(routes.filter((route) => route.method === 'GET').map((route) => bare(route.url)));
    const unique = new Map();
    for (const route of routes) {
      if (route.method === 'HEAD' && getUrls.has(bare(route.url))) continue;
      unique.set(`${route.method} ${route.url}`, route);
    }
    return [...unique.values()].sort((a, b) => (a.url === b.url
      ? compare(a.method, b.method)
      : compare(a.url, b.url)));
  } finally {
    await app.close();
  }
}

function compare(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** @param {string} url */
function groupOf(url) {
  const match = /^\/api\/([^/]+)/.exec(url);
  return match ? `/api/${match[1]}` : '(root)';
}

const GUARD_LEGEND = [
  ['admin', '`fastify.adminOnly`: valid, unrevoked staff session with role `ADMIN`.'],
  ['staff', '`fastify.authenticate`: valid, unrevoked JWT session (any role).'],
  ['api-key', '`fastify.authenticateWithApiKey`: hashed API key (AI bridge / ChatGPT actions).'],
  ['client-portal', '`clientAuth` in `client-portal.routes.js`: client portal session cookie.'],
  ['bot-secret', '`requireBotAuth` in `bot.routes.js`: bot bearer secret, fails closed without a bot tenant.'],
  ['recent-auth', '`requireRecentAuth` (`src/auth/reauth.js`): step-up re-authentication within the last 10 minutes in this session, else `403 REAUTH_REQUIRED`. Always paired with a session guard. See docs/privileged-actions.md.'],
  ['recent-auth (access change)', '`requireRecentAuthForAccessChange` in `team.routes.js`: `recent-auth`, only when the request changes the member\'s role or active state.'],
  ['scope …', '`requireApiKeyScope(scope)` (`src/auth/api-key-scopes.js`): the API key must carry that scope, else `403 INSUFFICIENT_SCOPE`.'],
  ['public', 'No auth hook. Each one is on the allowlist in the test, with the reason shown in the table.'],
];

/**
 * @param {Awaited<ReturnType<typeof collectAccessMatrix>>} routes
 * @returns {string}
 */
function renderAccessMatrix(routes) {
  const access = (route) => (route.guards.length ? route.guards.join(' + ') : 'public');
  const out = [];
  out.push('# API access matrix');
  out.push('');
  out.push('<!-- GENERATED FILE: do not edit by hand. -->');
  out.push('<!-- Source: src/tests/unit/api-access-matrix.test.js. Regenerate with -->');
  out.push('<!-- `UPDATE_ACCESS_MATRIX=1 npm test`; `npm test` fails when this file is stale. -->');
  out.push('');
  out.push('Every HTTP route the API registers, with the auth guard found in its');
  out.push('request lifecycle (route options plus hooks inherited from its plugin), as');
  out.push('asked for in #412. HEAD routes that Fastify derives from GET, and the');
  out.push('trailing-slash alias of each prefix root (`/api/x/` for `/api/x`), share');
  out.push('the listed route\'s lifecycle and are omitted.');
  out.push('');
  out.push('The global `onRequest` hook in `src/index.js` only *reads* a JWT when one is');
  out.push('present; it never rejects an anonymous request. A route without a guard');
  out.push('below is therefore reachable without a session, and any check it performs');
  out.push('happens inside its handler. Role checks inside handlers are not shown.');
  out.push('');
  out.push('The Tenancy column shows whether `tenancyMiddleware` scopes the route\'s');
  out.push('Prisma client to the caller\'s organization (`scoped`) or hands it the raw');
  out.push('client (`exempt`). A signed-in route marked `exempt` must confine its own');
  out.push('queries; the test keeps a reviewed list of those routes with the reason.');
  out.push('');
  out.push('## Guards');
  out.push('');
  out.push('| Access | Meaning |');
  out.push('| --- | --- |');
  for (const [name, meaning] of GUARD_LEGEND) out.push(`| ${name} | ${meaning} |`);
  out.push('');
  const counts = new Map();
  for (const route of routes) counts.set(access(route), (counts.get(access(route)) ?? 0) + 1);
  out.push('## Summary');
  out.push('');
  out.push('| Access | Routes |');
  out.push('| --- | --- |');
  for (const [name, count] of [...counts].sort((a, b) => compare(a[0], b[0]))) out.push(`| ${name} | ${count} |`);
  out.push(`| **total** | ${routes.length} |`);
  out.push('');
  out.push('## Routes by prefix');
  out.push('');
  const groups = new Map();
  for (const route of routes) {
    const group = groupOf(route.url);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(route);
  }
  for (const group of [...groups.keys()].sort(compare)) {
    out.push(`### ${group}`);
    out.push('');
    out.push('| Method | Path | Access | Tenancy | Notes |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const route of groups.get(group)) {
      const key = `${route.method} ${route.url}`;
      const allow = route.guards.length ? null : INTENTIONALLY_PUBLIC_ROUTES[key];
      const reason = allow ? `${allow.category}: ${allow.reason}` : (route.guards.length ? REVIEWED_UNSCOPED_ROUTES[key] ?? '' : '');
      out.push(`| ${route.method} | \`${route.url}\` | ${access(route)} | ${route.tenancy} | ${reason} |`);
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

let matrixPromise;
function getMatrix() {
  matrixPromise ??= collectAccessMatrix();
  return matrixPromise;
}

test('access matrix recognises the standard guards', async () => {
  const routes = await getMatrix();
  const byKey = new Map(routes.map((route) => [`${route.method} ${route.url}`, route]));
  assert.deepEqual(byKey.get('GET /api/audit-events')?.guards, ['admin']);
  assert.deepEqual(byKey.get('GET /api/auth/me')?.guards, ['staff']);
  assert.deepEqual(byKey.get('GET /api/ai-bridge/capabilities')?.guards, ['api-key']);
  assert.deepEqual(byKey.get('POST /api/auth/login')?.guards, []);
  assert.ok(routes.some((route) => route.guards.includes('client-portal')), 'no client-portal guarded route found');
  assert.ok(routes.some((route) => route.guards.includes('bot-secret')), 'no bot-secret guarded route found');
});

test('access matrix covers every route in the committed route table', async () => {
  const routes = await getMatrix();
  // printRoutes merges parameter names (`:id|:projectId`) and roots `*` at `/`.
  const bare = (url) => {
    const normalized = url.replace(/:[\w|:]+/g, ':').replace(/^\/?\*$/, '*');
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
  };
  const covered = new Set(routes.map((route) => `${route.method} ${bare(route.url)}`));
  const table = JSON.parse(fs.readFileSync(new URL('../fixtures/route-table.json', import.meta.url), 'utf8'));
  const missing = table
    .map((entry) => entry.split(' '))
    .filter(([method]) => method !== 'HEAD')
    .map(([method, url]) => `${method} ${bare(url)}`)
    .filter((key) => !covered.has(key));
  assert.deepEqual(missing, []);
});

test('re-authentication and scope checks never stand in for authentication', async () => {
  const routes = await getMatrix();
  const auth = new Set(['admin', 'staff', 'api-key']);
  const bare = routes
    .filter((route) => route.guards.some((guard) => guard.startsWith('recent-auth') || guard.startsWith('scope ')))
    .filter((route) => !route.guards.some((guard) => auth.has(guard)))
    .map((route) => `${route.method} ${route.url}`);
  assert.deepEqual(bare, []);
  const byKey = new Map(routes.map((route) => [`${route.method} ${route.url}`, route]));
  assert.deepEqual(byKey.get('POST /api/api-keys')?.guards, ['recent-auth', 'staff']);
  assert.deepEqual(byKey.get('POST /api/ai-bridge/v1/actions/prepare')?.guards, ['api-key', 'scope ai_bridge:actions']);
});

test('every unguarded route is on the documented public allowlist', async () => {
  const routes = await getMatrix();
  const unguarded = routes.filter((route) => route.guards.length === 0).map((route) => `${route.method} ${route.url}`);
  const unexpected = unguarded.filter((key) => !Object.hasOwn(INTENTIONALLY_PUBLIC_ROUTES, key));
  const stale = Object.keys(INTENTIONALLY_PUBLIC_ROUTES).filter((key) => !unguarded.includes(key));
  assert.deepEqual(
    { unexpected, stale },
    { unexpected: [], stale: [] },
    'Unguarded routes must carry fastify.authenticate/adminOnly (or another guard) or be added to '
      + 'INTENTIONALLY_PUBLIC_ROUTES with a reason; stale allowlist entries must be removed.',
  );
  for (const [key, entry] of Object.entries(INTENTIONALLY_PUBLIC_ROUTES)) {
    assert.ok(entry.category && entry.reason, `allowlist entry ${key} needs a category and reason`);
  }
});

test('docs/api-access-matrix.md matches the application', async () => {
  const actual = renderAccessMatrix(await getMatrix());
  if (process.env.UPDATE_ACCESS_MATRIX === '1') fs.writeFileSync(DOC_URL, actual);
  const expected = fs.existsSync(DOC_URL) ? fs.readFileSync(DOC_URL, 'utf8') : '';
  assert.equal(actual, expected, 'docs/api-access-matrix.md is stale; run UPDATE_ACCESS_MATRIX=1 npm test');
});

test('every signed-in route on the raw Prisma client has a reviewed tenant rule', async () => {
  const routes = await getMatrix();
  const unscoped = routes
    .filter((route) => route.tenancy === 'exempt' && route.guards.length > 0)
    .filter((route) => !route.guards.some((guard) => SELF_SCOPING_GUARDS.has(guard)))
    .map((route) => `${route.method} ${route.url}`);
  const unexpected = unscoped.filter((key) => !Object.hasOwn(REVIEWED_UNSCOPED_ROUTES, key));
  const stale = Object.keys(REVIEWED_UNSCOPED_ROUTES).filter((key) => !unscoped.includes(key));
  assert.deepEqual(
    { unexpected, stale },
    { unexpected: [], stale: [] },
    'A signed-in route under a tenancy-exempt prefix gets the unscoped Prisma client. Scope its '
      + 'queries to request.user.organizationId and add it to REVIEWED_UNSCOPED_ROUTES with the reason.',
  );
});
