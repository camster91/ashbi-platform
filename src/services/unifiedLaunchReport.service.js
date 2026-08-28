import fs from 'node:fs';
import path from 'node:path';
import { evaluateBonsaiCutoverReadiness } from './bonsai-cutover-readiness.service.js';
import { resolveContainedEvidenceFile } from './evidenceManifest.service.js';
import { evaluateUnifiedLaunchReadiness } from './unifiedLaunchReadiness.service.js';

function unavailableReport(configured) {
  return {
    configured,
    ready: false,
    checks: [{
      id: configured ? 'manifest-readable' : 'manifest-configured',
      ok: false,
      message: configured
        ? 'Provide one readable contained unified launch manifest.'
        : 'Configure the owner-controlled unified launch manifest before evaluating readiness.',
    }],
  };
}
export function loadUnifiedLaunchReadiness(manifestPath) {
  if (!String(manifestPath ?? '').trim()) return unavailableReport(false);

  try {
    const resolvedManifest = path.resolve(manifestPath);
    const manifestDirectory = path.dirname(resolvedManifest);
    const manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
    const nestedArtifact = manifest.artifacts?.find(item => item?.id === 'bonsai-cutover-manifest');
    const nestedPath = resolveContainedEvidenceFile(
      manifestDirectory,
      nestedArtifact?.path,
      'bonsai-cutover-manifest',
    );
    const nestedManifest = JSON.parse(fs.readFileSync(nestedPath, 'utf8'));
    const bonsaiCutoverReport = evaluateBonsaiCutoverReadiness({
      manifest: nestedManifest,
      manifestDirectory: path.dirname(nestedPath),
    });
    return {
      configured: true,
      ...evaluateUnifiedLaunchReadiness({
        manifest,
        manifestDirectory,
        bonsaiCutoverReport,
        bonsaiCutoverOrganizationId: nestedManifest.organizationId,
      }),
    };
  } catch {
    return unavailableReport(true);
  }
}
