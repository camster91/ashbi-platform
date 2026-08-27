import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBonsaiCutoverManifest } from '../../services/bonsaiCutoverManifest.service.js';
import { BONSAI_CUTOVER_ARTIFACT_IDS } from '../../services/bonsai-cutover-readiness.service.js';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-manifest-'));
  const example = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'bonsai-cutover-manifest.example.json'), 'utf8'));
  for (const artifact of example.artifacts) {
    const target = path.join(directory, artifact.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ id: artifact.id, evidence: 'synthetic-test-only' }));
  }
  const draftPath = path.join(directory, 'cutover-manifest.draft.json');
  fs.writeFileSync(draftPath, JSON.stringify(example));
  return { directory, draftPath, draft: example };
}

test('Bonsai manifest builder replaces placeholders with checksums for the exact required inventory', () => {
  const { directory, draft } = fixture();
  try {
    const manifest = buildBonsaiCutoverManifest({ evidenceDirectory: directory, draft });
    assert.deepEqual(manifest.artifacts.map(({ id }) => id), BONSAI_CUTOVER_ARTIFACT_IDS);
    for (const artifact of manifest.artifacts) {
      assert.notEqual(artifact.sha256, '0'.repeat(64));
      const content = fs.readFileSync(path.join(directory, artifact.path));
      assert.equal(artifact.sha256, crypto.createHash('sha256').update(content).digest('hex'));
    }
    assert.equal(manifest.approval.decision, 'PENDING');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Bonsai manifest builder rejects an incomplete, duplicate, or expanded artifact inventory', () => {
  const { directory, draft } = fixture();
  try {
    assert.throws(() => buildBonsaiCutoverManifest({
      evidenceDirectory: directory, draft: { ...draft, artifacts: draft.artifacts.slice(1) },
    }), /inventory/);
    assert.throws(() => buildBonsaiCutoverManifest({
      evidenceDirectory: directory, draft: { ...draft, artifacts: [...draft.artifacts, draft.artifacts[0]] },
    }), /inventory/);
    assert.throws(() => buildBonsaiCutoverManifest({
      evidenceDirectory: directory,
      draft: { ...draft, artifacts: [...draft.artifacts, { id: 'unreviewed-extra', path: 'evidence/extra.json' }] },
    }), /inventory/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Bonsai manifest preparation command creates one file without changing its pending approval', () => {
  const { directory } = fixture();
  const output = path.join(directory, 'cutover-manifest.json');
  try {
    const args = [
      'scripts/prepare-bonsai-cutover-manifest.mjs', '--evidence-dir', directory,
      '--draft', 'cutover-manifest.draft.json', '--output', output,
    ];
    const first = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /23 checksum-bound artifacts/);
    const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(manifest.approval.decision, 'PENDING');
    const second = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST|exist/i);
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['prepare:bonsai-cutover-manifest'], 'node scripts/prepare-bonsai-cutover-manifest.mjs');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
