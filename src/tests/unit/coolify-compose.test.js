import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (file) => parse(readFileSync(join(root, file), 'utf8'));
const env = (service) => Object.keys(service.environment);

test('the Coolify stack migrates first and persists data across redeploys', () => {
  const { services, volumes } = load('docker-compose.coolify.yml');
  assert.deepEqual(Object.keys(services).sort(), ['app', 'migrate', 'postgres', 'redis', 'worker']);
  assert.deepEqual(services.migrate.command, ['npx', 'prisma', 'migrate', 'deploy']);
  assert.equal(services.migrate.restart, 'no');
  for (const name of ['app', 'worker']) {
    const service = services[name];
    assert.equal(service.depends_on.migrate.condition, 'service_completed_successfully', `${name} starts before migrations finish`);
    assert.ok(service.volumes.includes('uploads:/app/uploads'), `${name} loses uploads on redeploy`);
    assert.ok(service.volumes.includes('appconfig:/app/config'), `${name} loses runtime config on redeploy`);
    assert.ok(service.healthcheck, `${name} has no health check`);
  }
  assert.match(services.postgres.image, /^pgvector\/pgvector:pg16/);
  assert.ok(services.postgres.volumes.includes('pgdata:/var/lib/postgresql/data'));
  assert.ok(services.redis.volumes.includes('redisdata:/data'));
  for (const volume of ['pgdata', 'redisdata', 'uploads', 'appconfig']) assert.ok(volume in volumes, `missing volume ${volume}`);
});

test('the Coolify stack publishes nothing on the host and requires its secrets', () => {
  const { services } = load('docker-compose.coolify.yml');
  for (const [name, service] of Object.entries(services)) {
    assert.equal(service.ports, undefined, `${name} publishes a host port`);
    assert.equal(service.container_name, undefined, `${name} pins a container name Coolify cannot manage`);
    if (service.environment) assert.equal(Array.isArray(service.environment), false, `${name} environment must use mappings for Coolify generation`);
  }
  assert.ok(env(services.app).includes('SERVICE_FQDN_APP_3002'), 'the proxy has no route to the API');
  const source = readFileSync(join(root, 'docker-compose.coolify.yml'), 'utf8');
  for (const secret of ['JWT_SECRET', 'CREDENTIALS_KEY', 'ADMIN_INVITE_TOKEN', 'WEBHOOK_SECRET', 'APP_URL', 'HUB_URL', 'PORTAL_BASE_URL', 'CORS_ORIGIN']) {
    assert.match(source, new RegExp(`\\$\\{${secret}:\\?`), `${secret} is not required`);
  }
  assert.doesNotMatch(source, /(SECRET|KEY|TOKEN|PASSWORD)(?:=|:\s*['"]?)[A-Za-z0-9]{8,}/, 'a literal secret is committed');
});

test('the Coolify stack sets the link hosts, drains on stop, and only passes variables the app reads', () => {
  const { services } = load('docker-compose.coolify.yml');
  // Unset, these fall back to the production host (src/config/env.js), so a
  // staging stack would email production links.
  for (const name of ['app', 'worker']) {
    for (const key of ['HUB_URL', 'PORTAL_BASE_URL', 'APP_URL']) assert.ok(env(services[name]).includes(key), `${name} does not set ${key}`);
  }
  assert.equal(services.app.stop_grace_period, '30s');
  assert.equal(services.worker.stop_grace_period, '120s');
  const read = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'tests') walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      for (const match of readFileSync(full, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) read.add(match[1]);
    }
  };
  walk(join(root, 'src'));
  // Read outside src/: Prisma (DATABASE_URL) and compose/Coolify itself.
  const external = new Set(['SERVICE_FQDN_APP_3002', 'DATABASE_URL', 'NODE_ENV', 'PORT']);
  for (const name of ['app', 'worker']) {
    for (const key of env(services[name])) {
      assert.ok(read.has(key) || external.has(key), `${name} sets ${key}, which the application never reads`);
    }
  }
});

test('the local compose stack also persists uploads and runtime config', () => {
  const { services, volumes } = load('docker-compose.yml');
  for (const name of ['app', 'worker']) {
    assert.ok(services[name].volumes.includes('uploads:/app/uploads'), `${name} loses uploads on redeploy`);
    assert.ok(services[name].volumes.includes('appconfig:/app/config'));
  }
  assert.ok('uploads' in volumes && 'appconfig' in volumes);
});

test('production adoption preserves existing stores and files without creating fresh databases', () => {
  const { services, networks, volumes } = load('docker-compose.coolify-production.yml');
  assert.deepEqual(Object.keys(services).sort(), ['app', 'migrate', 'worker']);
  assert.equal(volumes, undefined);
  assert.equal(networks['production-data'].external, true);
  assert.equal(networks['production-data'].name, 'ashbi-hub-src_default');
  assert.equal(services.app.environment.ADMIN_INVITE_TOKEN, '${ADMIN_INVITE_TOKEN:-}', 'adoption must not enable previously disabled bootstrap registration');
  assert.deepEqual(services.migrate.command, ['node', 'scripts/deploy/migrate-with-floor.mjs']);
  assert.equal(services.migrate.user, '0:0');
  assert.deepEqual(services.migrate.volumes, ['/opt/ashbi-platform/releases:/release-state']);
  assert.equal(services.app.user, undefined);
  assert.equal(services.worker.user, undefined);
  for (const service of Object.values(services)) {
    assert.equal(service.ports, undefined);
    assert.equal(service.environment.DATABASE_URL, '${DATABASE_URL:?}');
    assert.ok(service.networks.includes('production-data'));
    assert.equal(Array.isArray(service.environment), false);
  }
  for (const name of ['app', 'worker']) {
    assert.equal(services[name].environment.REDIS_URL, '${REDIS_URL:?}');
    assert.deepEqual(services[name].volumes, ['/opt/ashbi-platform/data/uploads:/app/uploads', '/opt/ashbi-platform/data/config:/app/config']);
    assert.equal(services[name].depends_on.migrate.condition, 'service_completed_successfully');
    assert.equal(services[name].build.args.APP_REVISION, '${SOURCE_COMMIT:-unknown}');
  }
});
