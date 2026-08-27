import { UNIFIED_LAUNCH_ARTIFACT_IDS } from './unifiedLaunchReadiness.service.js';
import { checksumContainedArtifacts, resolveNewEvidenceOutput } from './evidenceManifest.service.js';

export const UNIFIED_LAUNCH_CONVENTIONAL_PATHS = Object.freeze({
  'strategy-approval': 'evidence/strategy-approval.json',
  'ashbi-ca-deployment': 'evidence/ashbi-ca-deployment.json',
  'hub-deployment': 'evidence/hub-deployment.json',
  'controlled-journey': 'evidence/controlled-journey.json',
  'growth-cadence': 'evidence/growth-cadence.json',
  'notion-confirmed-import': 'evidence/notion-confirmed-import.json',
  'notion-idempotent-rerun': 'evidence/notion-idempotent-rerun.json',
  'bonsai-cutover-manifest': 'evidence/bonsai/cutover-manifest.json',
  'final-launch-approval': 'evidence/final-launch-approval.json',
});

function canonicalTimestamp(value, now) {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new Error('Evidence completion time must be a valid timestamp');
  if (parsed > now.getTime()) throw new Error('Evidence completion time cannot be in the future');
  return new Date(parsed).toISOString();
}

export function buildUnifiedLaunchManifest({
  evidenceDirectory,
  evidenceCompletedAt,
  artifactPaths = UNIFIED_LAUNCH_CONVENTIONAL_PATHS,
  now = new Date(),
} = {}) {
  const completedAt = canonicalTimestamp(evidenceCompletedAt, now);
  const artifacts = checksumContainedArtifacts({
    evidenceDirectory,
    requiredIds: UNIFIED_LAUNCH_ARTIFACT_IDS,
    artifactPaths,
  });
  return { schemaVersion: 1, evidenceCompletedAt: completedAt, artifacts };
}

export function resolveNewUnifiedManifestOutput(evidenceDirectory, outputPath) {
  return resolveNewEvidenceOutput(evidenceDirectory, outputPath);
}
