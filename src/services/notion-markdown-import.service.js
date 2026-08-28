import path from 'node:path';
import crypto from 'node:crypto';

const SOURCE_PREFIX = 'notion-markdown:';

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Notion import paths must be relative export paths');
  }
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Notion import paths must be relative export paths');
  }
  return normalized;
}

function sourceKey(relativePath) {
  return `${SOURCE_PREFIX}${relativePath}`;
}

export function buildNotionMarkdownImportPlan(relativePaths) {
  const normalized = relativePaths.map(normalizeRelativePath);
  return normalized
    .sort((left, right) => {
      const depthDifference = left.split('/').length - right.split('/').length;
      return depthDifference || left.localeCompare(right);
    })
    .map((relativePath) => {
      const directory = path.posix.dirname(relativePath);
      return {
        relativePath,
        sourceKey: sourceKey(relativePath),
        parentSourceKey: directory === '.' ? null : sourceKey(`${directory}.md`),
      };
    });
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function fingerprintNotionExport(fileEvidence) {
  return digest(fileEvidence
    .map(file => ({ relativePath: normalizeRelativePath(file.relativePath), bytes: file.bytes, sha256: file.sha256 }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath)));
}

export function fingerprintNotionPlan({ sourceFingerprint, report }) {
  return digest({
    sourceFingerprint,
    organizationId: report.organization.id,
    projectId: report.project.id,
    notes: {
      wouldCreate: report.notes.planned + report.notes.created,
      unchanged: report.notes.unchanged,
      conflicts: report.notes.conflicts,
      skipped: report.notes.skipped,
    },
    hierarchy: report.hierarchy,
    existingRecords: report.records.existing,
    errors: report.errors,
  });
}

export function assertApprovedNotionDryRun(approved, current) {
  if (!approved || approved.mode !== 'dry-run' || approved.format !== 'ashbi-notion-markdown-import-report') {
    throw new Error('Approved Notion evidence must be a dry-run report');
  }
  if (approved.organization?.id !== current.organizationId || approved.project?.id !== current.projectId) {
    throw new Error('Approved Notion report destination does not match');
  }
  if (approved.sandboxTarget?.environmentKind !== 'sandbox'
    || !approved.sandboxTarget?.targetFingerprint
    || approved.sandboxTarget.targetFingerprint !== current.targetFingerprint) {
    throw new Error('Approved Notion report sandbox target does not match');
  }
  if (approved.complete !== true || approved.errors?.length !== 0) {
    throw new Error('Approved Notion dry run is incomplete or has unresolved findings');
  }
  if (approved.sourceFingerprint !== current.sourceFingerprint) {
    throw new Error('Notion export changed after the approved dry run');
  }
  if (approved.planFingerprint !== current.planFingerprint) {
    throw new Error('Notion destination state or import plan changed after the approved dry run');
  }
  return true;
}

