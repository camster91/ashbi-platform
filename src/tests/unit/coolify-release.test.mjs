import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { release } from '../../../scripts/deploy/coolify-release.mjs';

const sha = 'a'.repeat(40);
const env = { RELEASE_SHA: sha, RELEASE_BRANCH: 'main', COOLIFY_RELEASE_ENABLED: 'true', COOLIFY_APP_UUID: 'app123', COOLIFY_TOKEN: 'test-only-token', COOLIFY_URL: 'https://coolify.example.test' };
const app = { uuid: 'app123', git_repository: 'https://github.com/camster91/ashbi-platform.git', git_branch: 'main', build_pack: 'dockercompose', docker_compose_location: '/docker-compose.coolify-production.yml', docker_compose_raw: readFileSync(new URL('../../../docker-compose.coolify-production.yml', import.meta.url), 'utf8'), docker_compose_domains: JSON.stringify({ app: { domain: 'https://hub.ashbi.ca' } }), domain_port_overrides: { 'https://hub.ashbi.ca': 3002 }, git_commit_sha: 'HEAD', settings: { is_auto_deploy_enabled: false, include_source_commit_in_build: true } };
function harness({ resource = app, retainedSha = sha, deployedSha = sha, publicSha = sha, status = 'finished', healthStatus = 'ok', queueUuid = 'app123', ready = true, checks = { database: { status: 'ok' }, redis: { status: 'ok' }, worker: { status: 'ok' } } } = {}) {
  const calls = [];
  const responses = [resource, { uuid: 'app123' }, { ...resource, git_commit_sha: retainedSha }, { deployments: [{ resource_uuid: queueUuid, deployment_uuid: 'release123' }] }, { status, commit: deployedSha }, { status: healthStatus, revision: publicSha, ready, checks }];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), ...options });
    const payload = responses.shift();
    if (!payload) throw new Error('Unexpected network request');
    return { ok: true, status: 200, json: async () => payload };
  }, sleep: async () => {}, log: () => {}, backup: async () => ({ releaseSha: sha, offServerCopyVerified: true }) };
}
test('disabled adoption makes no network requests', async () => {
  const h = harness();
  await assert.rejects(release({ ...env, COOLIFY_RELEASE_ENABLED: 'false' }, h), /not been enabled/);
  assert.equal(h.calls.length, 0);
});
test('failed or mismatched backup blocks every configuration write and deployment', async () => {
  for (const backup of [async () => { throw new Error('backup failed'); }, async () => null,
    async () => ({ releaseSha: 'b'.repeat(40), offServerCopyVerified: true }),
    async () => ({ releaseSha: sha, offServerCopyVerified: false })]) {
    const h = harness();
    await assert.rejects(release(env, { ...h, backup }));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].method, 'GET');
  }
});
test('wrong application or direct Git trigger is rejected before a write', async () => {
  for (const resource of [{ ...app, git_repository: 'camster91/other' }, { ...app, settings: { is_auto_deploy_enabled: true } }, { ...app, docker_compose_domains: '{}' }, { ...app, domain_port_overrides: {} }, { ...app, docker_compose_location: '/docker-compose.yml' }, { ...app, docker_compose_location: '/docker-compose.coolify.yml' }, { ...app, settings: { is_auto_deploy_enabled: false, include_source_commit_in_build: false } }]) {
    const h = harness({ resource });
    await assert.rejects(release(env, h));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].method, 'GET');
  }
});
test('partial SHA and unsafe API origins are rejected before sending credentials', async () => {
  for (const settings of [{ RELEASE_SHA: 'abc123' }, { COOLIFY_URL: 'http://coolify.example.test' }, { COOLIFY_URL: 'https://coolify.example.test/?token=x' }]) {
    const h = harness();
    await assert.rejects(release({ ...env, ...settings }, h));
    assert.equal(h.calls.length, 0);
  }
});
test('resource drift that removes loopback routing or changes production storage is rejected before writes', async () => {
  for (const raw of [undefined, app.docker_compose_raw.replace('127.0.0.1:3002:3002', '3002:3002'), app.docker_compose_raw.replace('/opt/ashbi-platform/data/uploads', '/tmp/fresh-uploads')]) {
    const h = harness({ resource: { ...app, docker_compose_raw: raw } });
    await assert.rejects(release(env, h), /Configured Compose differs/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].method, 'GET');
  }
});
test('unretained pin and mismatched deployment cannot be reported as a release', async () => {
  for (const options of [{ retainedSha: 'HEAD' }, { queueUuid: 'other123' }, { deployedSha: 'b'.repeat(40) }, { publicSha: 'c'.repeat(40) }, { publicSha: null }, { status: 'failed' }, { healthStatus: 'unavailable' }]) {
    await assert.rejects(release(env, harness(options)));
  }
});
test('pins exact CI revision, verifies matching deployment and checks readiness without the API token', async () => {
  const h = harness();
  assert.deepEqual(await release(env, h), { sha, deploymentUuid: 'release123' });
  assert.deepEqual(JSON.parse(h.calls[1].body), { git_commit_sha: sha });
  assert.equal(h.calls[3].method, 'POST');
  assert.equal(h.calls[5].headers.Authorization, undefined);
  assert.equal(h.calls[5].url, 'https://hub.ashbi.ca/api/health?strict=1');
  assert.ok(h.calls.every(call => call.redirect === 'error'));
});

test('an HTTP 200 or API revision alone cannot approve a failed database, Redis or worker', async () => {
  await assert.rejects(release(env, harness({ ready: false })));
  for (const name of ['database', 'redis', 'worker']) {
    const checks = { database: { status: 'ok' }, redis: { status: 'ok' }, worker: { status: 'ok' } };
    checks[name].status = 'unavailable';
    await assert.rejects(release(env, harness({ checks })), /strict API and worker/);
    delete checks[name];
    await assert.rejects(release(env, harness({ checks })), /strict API and worker/);
  }
});
