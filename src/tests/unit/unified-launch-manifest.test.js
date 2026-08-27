import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildUnifiedLaunchManifest,
  UNIFIED_LAUNCH_CONVENTIONAL_PATHS,
} from '../../services/unifiedLaunchManifest.service.js';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-unified-manifest-'));
  for (const [id, relativePath] of Object.entries(UNIFIED_LAUNCH_CONVENTIONAL_PATHS)) {
    const target = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ id, evidence: 'synthetic-test-only' }));
  }
  return directory;
}

test('manifest builder checksum-binds every conventional artifact in required order', () => {
  const directory = fixture();
  try {
    const manifest = buildUnifiedLaunchManifest({
      evidenceDirectory: directory,
      evidenceCompletedAt: '2026-03-10T12:00:00Z',
      now: new Date('2026-03-11T00:00:00Z'),
    });
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.evidenceCompletedAt, '2026-03-10T12:00:00.000Z');
    assert.deepEqual(manifest.artifacts.map(({ id }) => id), Object.keys(UNIFIED_LAUNCH_CONVENTIONAL_PATHS));
    for (const artifact of manifest.artifacts) {
      const content = fs.readFileSync(path.join(directory, artifact.path));
      assert.equal(artifact.sha256, crypto.createHash('sha256').update(content).digest('hex'));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('manifest builder rejects missing, duplicated, outside, and future evidence', () => {
  const directory = fixture();
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-unified-outside-'));
  const outside = path.join(outsideDirectory, 'outside.json');
  fs.writeFileSync(outside, '{}');
  try {
    fs.rmSync(path.join(directory, UNIFIED_LAUNCH_CONVENTIONAL_PATHS['growth-cadence']));
    assert.throws(() => buildUnifiedLaunchManifest({
      evidenceDirectory: directory, evidenceCompletedAt: '2026-03-10T12:00:00Z', now: new Date('2026-03-11T00:00:00Z'),
    }), /growth-cadence|ENOENT/);
    fs.writeFileSync(path.join(directory, UNIFIED_LAUNCH_CONVENTIONAL_PATHS['growth-cadence']), '{}');

    const linkedArtifact = path.join(directory, UNIFIED_LAUNCH_CONVENTIONAL_PATHS['growth-cadence']);
    fs.rmSync(linkedArtifact);
    fs.symlinkSync(outside, linkedArtifact, 'file');
    assert.throws(() => buildUnifiedLaunchManifest({
      evidenceDirectory: directory, evidenceCompletedAt: '2026-03-10T12:00:00Z', now: new Date('2026-03-11T00:00:00Z'),
    }), /inside the evidence directory/);
    fs.rmSync(linkedArtifact);
    fs.writeFileSync(linkedArtifact, '{}');

    const duplicatePaths = { ...UNIFIED_LAUNCH_CONVENTIONAL_PATHS, 'growth-cadence': UNIFIED_LAUNCH_CONVENTIONAL_PATHS['controlled-journey'] };
    assert.throws(() => buildUnifiedLaunchManifest({
      evidenceDirectory: directory, evidenceCompletedAt: '2026-03-10T12:00:00Z', artifactPaths: duplicatePaths,
      now: new Date('2026-03-11T00:00:00Z'),
    }), /duplicates/);

    const outsidePaths = { ...UNIFIED_LAUNCH_CONVENTIONAL_PATHS, 'growth-cadence': path.relative(directory, outside) };
    assert.throws(() => buildUnifiedLaunchManifest({
      evidenceDirectory: directory, evidenceCompletedAt: '2026-03-10T12:00:00Z', artifactPaths: outsidePaths,
      now: new Date('2026-03-11T00:00:00Z'),
    }), /inside the evidence directory/);
    assert.throws(() => buildUnifiedLaunchManifest({
      evidenceDirectory: directory, evidenceCompletedAt: '2026-03-12T00:00:00Z', now: new Date('2026-03-11T00:00:00Z'),
    }), /future/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
});

test('manifest preparation command creates one owner-controlled file and refuses overwrite', () => {
  const directory = fixture();
  const output = path.join(directory, 'unified-launch-manifest.json');
  try {
    const args = [
      'scripts/prepare-unified-launch-manifest.mjs', '--evidence-dir', directory,
      '--evidence-completed-at', '2026-03-10T12:00:00Z', '--output', output,
    ];
    const first = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /9 checksum-bound artifacts/);
    const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(manifest.artifacts.length, 9);
    const second = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST|exist/i);
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['prepare:unified-launch-manifest'], 'node scripts/prepare-unified-launch-manifest.mjs');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
