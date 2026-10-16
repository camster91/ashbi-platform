import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import YAML from 'yaml';

const source = readFileSync(new URL('../../../.github/workflows/build-release-artifact.yml', import.meta.url), 'utf8');
const workflow = YAML.parse(source);
const steps = workflow.jobs.build.steps;

test('manual main-only source artifact build grants no deployment or registry permissions', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['build']);
  assert.equal(workflow.jobs.build.if, "github.ref == 'refs/heads/main'");
  assert.equal(workflow.jobs.build['runs-on'], 'ubuntu-24.04');
  assert.equal(workflow.jobs.build.environment, undefined);
  assert.equal(workflow.jobs.build.permissions, undefined);
  const checkout = steps.find(step => step.uses === 'actions/checkout@v7');
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\.|packages:\s*write|id-token:|attestations:|docker\s+(?:push|login)|ghcr\.io|\bssh\b|deploy-vps-direct|COOLIFY_|--push/);
});

test('secret scan precedes immutable amd64 build and only the bounded archive metadata is uploaded', () => {
  const scan = steps.findIndex(step => step.run === 'node scripts/check-secrets.mjs .');
  const build = steps.findIndex(step => step.name === 'Build exact amd64 image');
  assert.ok(scan >= 0 && scan < build);
  assert.match(steps[build].run, /docker buildx build --load --platform linux\/amd64/);
  assert.match(steps[build].run, /--build-arg "APP_REVISION=\$RELEASE_REVISION"/);
  assert.match(steps[build].run, /--tag "ashbi-platform:\$RELEASE_REVISION"/);
  assert.match(steps.find(step => step.name === 'Verify source revision').run, /\^\[0-9a-f\]\{40\}\$/);
  const upload = steps.find(step => step.uses === 'actions/upload-artifact@v7');
  assert.equal(upload.with['retention-days'], 3);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.deepEqual(upload.with.path.trim().split('\n'), ['release-artifact/*.tar', 'release-artifact/metadata.json', 'release-artifact/SHA256SUMS']);
  assert.equal(upload.if, undefined);
  const ignore = readFileSync(new URL('../../../.dockerignore', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('.env')); assert.ok(ignore.includes('.env.*'));
});

// Execute only the actual embedded metadata verifier with synthetic inspection
// JSON and archive bytes. No Docker daemon, image build or network is invoked.
const script = steps.find(step => step.name === 'Verify and save immutable image').run.split("python3 - <<'PY'\n")[1].split('\nPY')[0];
function verify(t, overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ashbi-artifact-contract-'));
  mkdirSync(path.join(dir, 'release-artifact'));
  t.after(() => { for (const entry of readdirSync(path.join(dir, 'release-artifact'))) rmSync(path.join(dir, 'release-artifact', entry)); rmdirSync(path.join(dir, 'release-artifact')); rmSync(path.join(dir, 'inspect.json')); rmdirSync(dir); });
  const revision = 'a'.repeat(40), archive = `release-artifact/ashbi-platform-${revision}.tar`;
  const bytes = Buffer.from('synthetic saved image archive'); writeFileSync(path.join(dir, archive), bytes);
  const info = { Id: `sha256:${'b'.repeat(64)}`, Architecture: 'amd64', Os: 'linux', Size: 999,
    Config: { Env: [`APP_REVISION=${revision}`], Labels: { 'org.opencontainers.image.revision': revision } }, ...overrides };
  writeFileSync(path.join(dir, 'inspect.json'), JSON.stringify([info]));
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, RELEASE_REVISION: revision, IMAGE: `ashbi-platform:${revision}`, INSPECT_PATH: path.join(dir, 'inspect.json'), ARCHIVE: archive } });
  return { result, dir, revision, bytes };
}

test('actual metadata verifier binds revision, architecture, archive bytes and checksums', t => {
  const { result, dir, revision, bytes } = verify(t); assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(readFileSync(path.join(dir, 'release-artifact/metadata.json'), 'utf8'));
  assert.deepEqual(metadata, { revision, image: `ashbi-platform:${revision}`, imageId: `sha256:${'b'.repeat(64)}`, size: 999, architecture: 'amd64', archiveSha256: createHash('sha256').update(bytes).digest('hex'), archiveBytes: bytes.length });
  const sums = readFileSync(path.join(dir, 'release-artifact/SHA256SUMS'), 'utf8');
  assert.ok(sums.includes(`${metadata.archiveSha256}  ashbi-platform-${revision}.tar`));
  const metadataHash = createHash('sha256').update(readFileSync(path.join(dir, 'release-artifact/metadata.json'))).digest('hex');
  assert.ok(sums.includes(`${metadataHash}  metadata.json`));
});

for (const overrides of [ { Architecture: 'arm64' }, { Id: 'mutable-tag' }, { Config: { Env: ['APP_REVISION=unknown'], Labels: {} } }, { Config: { Env: [`APP_REVISION=${'a'.repeat(40)}`], Labels: { 'org.opencontainers.image.revision': 'b'.repeat(40) } } } ]) {
  test(`actual metadata verifier refuses mismatched image evidence ${JSON.stringify(overrides)}`, t => {
    const { result } = verify(t, overrides); assert.notEqual(result.status, 0);
  });
}
