import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (file) => parse(readFileSync(join(root, file), 'utf8'));
const env = (service) => service.environment.map((entry) => entry.split('=')[0]);

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
  }
  assert.ok(env(services.app).includes('SERVICE_FQDN_APP_3002'), 'the proxy has no route to the API');
  const source = readFileSync(join(root, 'docker-compose.coolify.yml'), 'utf8');
  for (const secret of ['JWT_SECRET', 'CREDENTIALS_KEY', 'ADMIN_INVITE_TOKEN', 'WEBHOOK_SECRET', 'APP_URL', 'CORS_ORIGIN']) {
    assert.match(source, new RegExp(`\\$\\{${secret}:\\?`), `${secret} is not required`);
  }
  assert.doesNotMatch(source, /(SECRET|KEY|TOKEN|PASSWORD)=[A-Za-z0-9]{8,}/, 'a literal secret is committed');
});

test('the local compose stack also persists uploads and runtime config', () => {
  const { services, volumes } = load('docker-compose.yml');
  for (const name of ['app', 'worker']) {
    assert.ok(services[name].volumes.includes('uploads:/app/uploads'), `${name} loses uploads on redeploy`);
    assert.ok(services[name].volumes.includes('appconfig:/app/config'));
  }
  assert.ok('uploads' in volumes && 'appconfig' in volumes);
});
