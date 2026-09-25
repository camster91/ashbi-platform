import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildApp } from '../../index.js';
import { registerCoreRevenueRoutes } from '../../domains/revenue/register-core-routes.js';
import { registerWorkManagementRoutes } from '../../domains/client-delivery/register-work-management-routes.js';

test('buildApp constructs the complete API without listening', async () => {
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  try {
    assert.equal(app.server.listening, false);
    const response = await app.inject({ method: 'GET', url: '/api/live' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'ok');
  } finally {
    await app.close();
  }
});

test('process lifecycle is isolated from application construction', () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

  assert.doesNotMatch(factory, /\.listen\s*\(/);
  assert.doesNotMatch(factory, /process\.on\s*\(/);
  assert.match(server, /await buildApp\(\)/);
  assert.match(server, /process\.once\('SIGINT'/);
  assert.match(server, /process\.once\('SIGTERM'/);
  assert.equal(packageJson.scripts['start:api'], 'node --import ./src/tracing.js src/server.js');
});

test('runtime subscribers receive dependencies instead of importing the entry point', () => {
  for (const relative of [
    '../../subscribers/notification.subscriber.js',
    '../../subscribers/socket.subscriber.js',
    '../../services/notification.service.js',
    '../../routes/notification.routes.js',
  ]) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /import\(['"]\.\.\/index\.js['"]\)|from ['"]\.\.\/index\.js['"]/);
  }
});

test('the backend boundary and incremental domain plan are documented', () => {
  const documentation = fs.readFileSync(new URL('../../../docs/backend-application-boundaries.md', import.meta.url), 'utf8');
  assert.match(documentation, /server -> app ->/);
  assert.match(documentation, /identity and access/);
  assert.match(documentation, /client delivery/);
  assert.match(documentation, /revenue/);
  assert.match(documentation, /integrations and operations/);
});

test('core revenue routes are owned by a domain registrar', () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const registrar = fs.readFileSync(new URL('../../domains/revenue/register-core-routes.js', import.meta.url), 'utf8');

  assert.match(factory, /registerCoreRevenueRoutes\(fastify\)/);
  for (const route of ['invoice-chaser', 'invoice', 'contract', 'proposal']) {
    assert.doesNotMatch(factory, new RegExp(`routes\\/${route}\\.routes\\.js`));
    assert.match(registrar, new RegExp(`routes\\/${route}\\.routes\\.js`));
  }
  for (const prefix of ['/api/invoice-chaser', '/api/invoices', '/api/contracts', '/api/proposals']) {
    assert.match(registrar, new RegExp(prefix));
  }
});

test('core revenue registrar preserves route order and prefixes', async () => {
  const registrations = [];
  const fastify = {
    async register(plugin, options) {
      registrations.push({ plugin, prefix: options.prefix });
    },
  };

  await registerCoreRevenueRoutes(fastify);

  assert.deepEqual(registrations.map(({ prefix }) => prefix), [
    '/api/invoice-chaser',
    '/api/invoices',
    '/api/contracts',
    '/api/proposals',
  ]);
  assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, 4);
  assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
});

test('project collaboration routes are owned by an ordered domain registrar', async () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const registrarUrl = new URL('../../domains/client-delivery/register-collaboration-routes.js', import.meta.url);
  const registrar = fs.readFileSync(registrarUrl, 'utf8');
  const { registerCollaborationRoutes } = await import(registrarUrl.href);
  const routeNames = ['message', 'revision', 'calendar', 'comment', 'attachment', 'time', 'milestone'];
  const expectedPrefixes = [
    '/api/messages',
    '/api/revisions',
    '/api/calendar',
    '/api/comments',
    '/api/attachments',
    '/api/time',
    '/api/milestones',
  ];

  assert.match(factory, /registerCollaborationRoutes\(fastify\)/);
  for (const route of routeNames) {
    assert.doesNotMatch(factory, new RegExp(`routes\\/${route}\\.routes\\.js`));
    assert.match(registrar, new RegExp(`routes\\/${route}\\.routes\\.js`));
  }

  const registrations = [];
  await registerCollaborationRoutes({
    async register(plugin, options) {
      registrations.push({ plugin, prefix: options.prefix });
    },
  });

  assert.deepEqual(registrations.map(({ prefix }) => prefix), expectedPrefixes);
  assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, routeNames.length);
  assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
});

test('client work-management routes are owned by an ordered domain registrar', async () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const registrar = fs.readFileSync(new URL('../../domains/client-delivery/register-work-management-routes.js', import.meta.url), 'utf8');
  const routeNames = ['client', 'project', 'task'];
  const expectedPrefixes = ['/api/clients', '/api/projects', '/api/tasks'];

  assert.match(factory, /registerWorkManagementRoutes\(fastify\)/);
  for (const route of routeNames) {
    assert.doesNotMatch(factory, new RegExp(`routes\\/${route}\\.routes\\.js`));
    assert.match(registrar, new RegExp(`routes\\/${route}\\.routes\\.js`));
  }

  const registrations = [];
  await registerWorkManagementRoutes({
    async register(plugin, options) {
      registrations.push({ plugin, prefix: options.prefix });
    },
  });

  assert.deepEqual(registrations.map(({ prefix }) => prefix), expectedPrefixes);
  assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, routeNames.length);
  assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
});

test('client communication routes are owned by an ordered domain registrar', async () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const registrarUrl = new URL('../../domains/client-communications/register-routes.js', import.meta.url);
  assert.equal(fs.existsSync(registrarUrl), true, 'client communications registrar must exist');

  const registrar = fs.readFileSync(registrarUrl, 'utf8');
  const { registerClientCommunicationRoutes } = await import(registrarUrl.href);
  const routeNames = ['response', 'thread', 'webhook', 'client-portal', 'gmail'];
  const expectedPrefixes = [
    '/api/responses',
    '/api/threads',
    '/api/webhooks',
    '/api/client-portal',
    '/api/gmail',
  ];

  assert.match(factory, /registerClientCommunicationRoutes\(fastify\)/);
  for (const route of routeNames) {
    assert.doesNotMatch(factory, new RegExp(`routes\\/${route}\\.routes\\.js`));
    assert.match(registrar, new RegExp(`routes\\/${route}\\.routes\\.js`));
  }

  const registrations = [];
  await registerClientCommunicationRoutes({
    async register(plugin, options) {
      registrations.push({ plugin, prefix: options.prefix });
    },
  });

  assert.deepEqual(registrations.map(({ prefix }) => prefix), expectedPrefixes);
  assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, routeNames.length);
  assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
});

test('conversation routes are owned by an ordered domain registrar', async () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  const registrarUrl = new URL('../../domains/client-communications/register-conversation-routes.js', import.meta.url);
  assert.equal(fs.existsSync(registrarUrl), true, 'conversation registrar must exist');

  const registrar = fs.readFileSync(registrarUrl, 'utf8');
  const { registerConversationRoutes } = await import(registrarUrl.href);
  const routeNames = ['ash-chat', 'chat'];
  const expectedPrefixes = ['/api/ash-chat', '/api/chat'];

  assert.match(factory, /registerConversationRoutes\(fastify\)/);
  for (const route of routeNames) {
    assert.doesNotMatch(factory, new RegExp(`routes\\/${route}\\.routes\\.js`));
    assert.match(registrar, new RegExp(`routes\\/${route}\\.routes\\.js`));
  }

  const registrations = [];
  await registerConversationRoutes({
    async register(plugin, options) {
      registrations.push({ plugin, prefix: options.prefix });
    },
  });

  assert.deepEqual(registrations.map(({ prefix }) => prefix), expectedPrefixes);
  assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, routeNames.length);
  assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
});

const DOMAIN_REGISTRARS = [
  {
    file: 'identity/register-routes.js',
    exportName: 'registerIdentityRoutes',
    routes: [
      ['auth', '/api/auth'],
      ['settings', '/api/settings'],
      ['api-key', '/api/api-keys'],
      ['credential', '/api/credentials'],
      ['team', '/api/team'],
    ],
  },
  {
    file: 'client-communications/register-inbox-routes.js',
    exportName: 'registerInboxRoutes',
    routes: [
      ['inbox', '/api/inbox'],
      ['email-triage', '/api/email-triage'],
    ],
  },
  {
    file: 'platform/register-routes.js',
    exportName: 'registerPlatformRoutes',
    routes: [
      ['dashboard', '/api/dashboard'],
      ['notification', '/api/notifications'],
      ['realtime', '/api/realtime'],
      ['push', '/api/push'],
      ['trash', '/api/trash'],
      ['draft', '/api/draft'],
      ['search', '/api/search'],
    ],
  },
  {
    file: 'ai/register-routes.js',
    exportName: 'registerAiRoutes',
    routes: [
      ['ai', '/api/ai'],
      ['ai-bridge', '/api/ai-bridge'],
      ['semantic-search', '/api/semantic-search'],
      ['automation', '/api/automations'],
      ['ai-context', '/api/ai-context'],
      ['ai-team', '/api/ai-team'],
      ['bot', '/api/bot'],
      ['approvals', '/api/approvals'],
    ],
  },
  {
    file: 'revenue/register-commercial-routes.js',
    exportName: 'registerCommercialRevenueRoutes',
    routes: [
      ['proposal-builder', '/api/proposal-builder'],
      ['estimate', '/api/estimates'],
      ['rate-card', '/api/rate-cards'],
      ['pipeline', '/api/pipeline'],
      ['expense', '/api/expenses'],
      ['leads', '/api/leads'],
      ['client-acquisition', '/api/client-acquisition'],
      ['retainer', '/api/retainers'],
    ],
  },
  {
    file: 'integrations/register-routes.js',
    exportName: 'registerIntegrationRoutes',
    routes: [
      ['integration', '/api/integrations'],
      ['integrations.command-center', '/api/command-center'],
      ['mailgun-hitl', '/api/mailgun-hitl'],
      ['mailgun', '/api/mailgun'],
      ['slack-events', '/api/slack/events'],
      ['slack', '/api/slack'],
      ['google-calendar', '/api/google-calendar'],
    ],
  },
  {
    file: 'client-delivery/register-workspace-routes.js',
    exportName: 'registerClientWorkspaceRoutes',
    routes: [
      ['brand', '/api/brand'],
      ['time-tracking', '/api/time-tracking'],
      ['time-sessions', '/api/time-sessions'],
      ['creative-brief', '/api/creative-brief'],
      ['asset-library', '/api/asset-library'],
      ['template', '/api/templates'],
      ['portal', '/api/portal'],
      ['onboarding', '/api/onboarding'],
      ['note', '/api'],
    ],
  },
];

for (const { file, exportName, routes } of DOMAIN_REGISTRARS) {
  test(`${exportName} owns its routes with exact prefixes and order`, async () => {
    const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
    const registrarUrl = new URL(`../../domains/${file}`, import.meta.url);
    assert.equal(fs.existsSync(registrarUrl), true, `${file} must exist`);
    const registrar = fs.readFileSync(registrarUrl, 'utf8');
    const module = await import(registrarUrl.href);

    assert.match(factory, new RegExp(`await ${exportName}\\(fastify\\)`));
    for (const [route] of routes) {
      const pattern = new RegExp(`routes\\/${route.replace('.', '\\.')}\\.routes\\.js`);
      assert.doesNotMatch(factory, pattern);
      assert.match(registrar, pattern);
    }

    const registrations = [];
    await module[exportName]({
      async register(plugin, options) {
        registrations.push({ plugin, options });
      },
    });

    assert.deepEqual(registrations.map(({ options }) => options), routes.map(([, prefix]) => ({ prefix })));
    assert.equal(new Set(registrations.map(({ plugin }) => plugin)).size, routes.length);
    assert.ok(registrations.every(({ plugin }) => typeof plugin === 'function'));
  });
}

test('the application factory registers no route module directly', () => {
  const factory = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(factory, /from ['"]\.\/routes\//, 'src/index.js must register routes through src/domains registrars');
  assert.doesNotMatch(factory, /import\(['"]\.\/routes\//);
  assert.doesNotMatch(factory, /fastify\.register\(\s*\w*Routes\b/);
});

test('every domain-registered route module has exactly one owner', () => {
  const domainsDir = new URL('../../domains/', import.meta.url);
  const owners = new Map();
  for (const dir of fs.readdirSync(domainsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const file of fs.readdirSync(new URL(`${dir.name}/`, domainsDir)).filter((name) => /^register-.*\.js$/.test(name))) {
      const owner = `${dir.name}/${file}`;
      const source = fs.readFileSync(new URL(owner, domainsDir), 'utf8');
      for (const [, route] of source.matchAll(/^import \w+ from '\.\.\/\.\.\/routes\/([\w.-]+)\.routes\.js';$/gm)) {
        assert.equal(owners.has(route), false, `${route} is registered by both ${owners.get(route)} and ${owner}`);
        owners.set(route, owner);
      }
    }
  }
  // 21 modules from the earlier slices plus 46 moved out of src/index.js.
  assert.equal(owners.size, 67);
});

test('route modules stay encapsulated so cross-domain registration order cannot leak hooks', () => {
  // Grouping by domain changed the relative order of some route plugins. That
  // is behavior-preserving only while no route module escapes Fastify
  // encapsulation (fastify-plugin / skip-override) to share hooks,
  // decorators, or content-type parsers with sibling plugins.
  const routesDir = new URL('../../routes/', import.meta.url);
  for (const file of fs.readdirSync(routesDir).filter((name) => name.endsWith('.routes.js'))) {
    const source = fs.readFileSync(new URL(file, routesDir), 'utf8');
    assert.doesNotMatch(source, /fastify-plugin|skip-override/, `${file} must remain an encapsulated plugin`);
  }
});
