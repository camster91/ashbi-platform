import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
  const build = steps.findIndex(step => step.name === 'Build exact amd64 OCI gzip image');
  assert.ok(scan >= 0 && scan < build);
  assert.match(steps[build].run, /docker buildx build --platform linux\/amd64/);
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



test('OCI exporter disables extra attestations, uses gzip and never loads or pushes an image', () => {
  const build=steps.find(step=>step.name==='Build exact amd64 OCI gzip image').run;
  assert.match(build,/--provenance=false --sbom=false/);
  assert.match(build,/type=oci,dest=.*compression=gzip,force-compression=true,oci-mediatypes=true/);
  assert.doesNotMatch(build,/--load|--push/);
  const validate=steps.find(step=>step.name==='Validate and canonicalize OCI artifact').run;
  assert.match(validate,/python3 scripts\/deploy\/prepare-oci-artifact.py/);
  assert.match(validate,/--revision "\$RELEASE_REVISION"/);
  assert.match(validate,/--builder-run-id "\$GITHUB_RUN_ID" --repository "\$GITHUB_REPOSITORY"/);
});

test('actual offline OCI validator accepts canonical identity and rejects malformed synthetic archives', () => {
  const script=fileURLToPath(new URL('../../../scripts/deploy/test_prepare_oci_artifact.py',import.meta.url));
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-B',script],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stderr,/Ran 12 tests/);
  assert.match(result.stderr,/OK/);
});
