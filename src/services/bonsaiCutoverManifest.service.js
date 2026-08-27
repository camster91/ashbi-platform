import { BONSAI_CUTOVER_ARTIFACT_IDS } from './bonsai-cutover-readiness.service.js';
import { checksumContainedArtifacts } from './evidenceManifest.service.js';

export function buildBonsaiCutoverManifest({ evidenceDirectory, draft } = {}) {
  if (draft?.schemaVersion !== 1 || !Array.isArray(draft?.artifacts)) {
    throw new Error('Bonsai cutover draft must use schema version 1 and include artifacts');
  }
  const ids = draft.artifacts.map(artifact => artifact?.id);
  if (new Set(ids).size !== ids.length
    || ids.length !== BONSAI_CUTOVER_ARTIFACT_IDS.length
    || !BONSAI_CUTOVER_ARTIFACT_IDS.every(id => ids.includes(id))) {
    throw new Error('Bonsai cutover draft artifact inventory must match the required contract exactly');
  }
  const artifactPaths = Object.fromEntries(draft.artifacts.map(artifact => [artifact.id, artifact.path]));
  const artifacts = checksumContainedArtifacts({
    evidenceDirectory,
    requiredIds: BONSAI_CUTOVER_ARTIFACT_IDS,
    artifactPaths,
  });
  return { ...draft, artifacts };
}
