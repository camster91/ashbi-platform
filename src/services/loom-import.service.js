// Controlled, one-way import of Loom recordings into project media
// attachments (#414). Playbook: docs/loom-migration.md.
//
// Loom has no documented bulk export, so the workspace owner downloads each
// recording (MP4 or WebM) and lists it in an operator-prepared
// `loom-manifest.csv`. Each manifest row becomes one project attachment (the
// same row `POST /api/attachments` creates, so it appears in the project's
// files and can be put up for media review), stored through the same upload
// policy and storage code as every other upload.
//
// Same contract as the Slack export importer: a dry run plans without writing;
// a live run writes everything in one transaction and rolls back on any
// blocking finding; every imported recording gets a durable reconciliation
// record keyed by its Loom video id, so reruns never duplicate and a changed
// source is reported rather than overwritten. Each live run is recorded in
// `import_runs` and can be rolled back by id.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { recordAuditEvent } from './audit-event.service.js';
import { storeValidatedUpload, unlinkStoredUpload } from './chat-attachment.service.js';
import { isQuarantined } from './media-review.service.js';
import {
  OperatorImportBlockedError,
  OperatorImportError,
  TRANSACTION_OPTIONS,
  countBy,
  findInChunks,
  inspectMediaFile,
  lockImportRun,
  lockRowsForUpdate,
  pendingRollbackFiles,
  removeRolledBackFiles,
  summaryWithPendingFiles,
  insertInChunks,
  normalizeEmail,
  parseIsoTimestamp,
  readCsvTable,
  readInputCsv,
  resolveInputDirectory,
  safeFileName,
  sanitizeDisplayText,
  sha256,
} from './operator-import-common.js';

export const LOOM_IMPORT_SOURCE = 'LOOM_MANIFEST';
export const LOOM_MANIFEST_FILE = 'loom-manifest.csv';
export const LOOM_COLUMNS = Object.freeze(['loom_url', 'title', 'created_at', 'owner_email', 'file_name', 'project_id']);
export const LOOM_OPTIONAL_COLUMNS = Object.freeze(['description']);
// Loom downloads are MP4; browser-recorded WebM is accepted as well. Both are
// in the upload policy (src/security/file-upload-policy.js).
export const LOOM_FILE_TYPES = Object.freeze({ '.mp4': 'video/mp4', '.webm': 'video/webm' });
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const STAFF_ROLES = new Set(['ADMIN', 'TEAM']);

// Findings that skip one recording but do not block the run: the file is
// reported and not imported (the owner keeps the 50 MB limit).
const SKIPPED_FILE_CODES = new Set(['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'INVALID_CONTENT']);

export { OperatorImportBlockedError as LoomImportBlockedError, OperatorImportError as LoomImportError };

export function loomSourceKey(videoId) {
  return `loom:${videoId}`;
}

/**
 * The Loom video id of a share or embed URL, and its canonical share URL.
 * Accepts https://(www.)loom.com/share/<id> and /embed/<id>, with or without
 * a title slug before a 32-hex id; drops any query string or fragment.
 */
export function parseLoomUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !['loom.com', 'www.loom.com'].includes(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || url.port) return null;
  const match = /^\/(?:share|embed)\/([A-Za-z0-9-]{1,200})\/?$/.exec(url.pathname);
  if (!match) return null;
  const slugged = /(?:^|-)([0-9a-f]{32})$/i.exec(match[1]);
  const videoId = slugged ? slugged[1].toLowerCase() : (/^[A-Za-z0-9]{10,64}$/.test(match[1]) ? match[1] : null);
  return videoId ? { videoId, loomUrl: `https://www.loom.com/share/${videoId}` } : null;
}

function contentSha256(item) {
  return sha256(JSON.stringify({
    loomUrl: item.loomUrl,
    title: item.title,
    createdAt: item.createdAt.toISOString(),
    ownerEmail: item.ownerEmail,
    description: item.description,
    fileSha256: item.file.sha256,
  }));
}

/**
 * Validate one manifest row. Returns the parsed item, or `{ error }` with a
 * blocking INVALID_ROW / UNSAFE_PATH finding.
 */
export function parseLoomManifestRow(row) {
  const problems = [];
  const parsedUrl = parseLoomUrl(row.loom_url);
  if (!parsedUrl) problems.push('loom_url must be a https://www.loom.com/share/<id> link');
  const title = sanitizeDisplayText(row.title, TITLE_MAX);
  if (!title) problems.push('title is required');
  const createdAt = parseIsoTimestamp(row.created_at);
  if (!createdAt) problems.push('created_at must be an ISO 8601 timestamp with an offset, e.g. 2025-03-04T10:15:00-05:00');
  const projectId = String(row.project_id ?? '').trim();
  if (!projectId) problems.push('project_id is required');
  const fileName = safeFileName(row.file_name);
  const rawOwnerEmail = String(row.owner_email ?? '').trim();
  if (!fileName) {
    return { error: { code: 'UNSAFE_PATH', row: row.__line, error: 'file_name must name a file directly inside the input directory' } };
  }
  if (problems.length) return { error: { code: 'INVALID_ROW', row: row.__line, error: problems.join('; ') } };
  const description = sanitizeDisplayText(String(row.description ?? ''), DESCRIPTION_MAX);
  return {
    item: {
      row: row.__line,
      videoId: parsedUrl.videoId,
      sourceKey: loomSourceKey(parsedUrl.videoId),
      loomUrl: parsedUrl.loomUrl,
      title,
      createdAt,
      ownerEmail: normalizeEmail(rawOwnerEmail),
      rawOwnerEmail: rawOwnerEmail ? sanitizeDisplayText(rawOwnerEmail, 254) : null,
      fileName,
      projectId,
      description,
    },
  };
}

/**
 * Read an operator-prepared Loom input directory: `loom-manifest.csv` plus the
 * downloaded recordings it names. Files are inspected (size, SHA-256, upload
 * policy) but not kept in memory.
 */
export async function readLoomImport(inputDir) {
  const { root, label } = await resolveInputDirectory(inputDir, 'Loom');
  const table = readCsvTable(await readInputCsv(root, LOOM_MANIFEST_FILE), { columns: LOOM_COLUMNS, optional: LOOM_OPTIONAL_COLUMNS });
  const errors = table.rowErrors.map((rowError) => ({ code: 'INVALID_ROW', ...rowError }));
  const warnings = table.unknownColumns.map((column) => ({ code: 'UNKNOWN_COLUMN', column: sanitizeDisplayText(column, 80), error: 'Column is not part of the template and is ignored' }));
  const items = [];
  const byKey = new Map();
  const byFile = new Map();
  for (const row of table.rows) {
    const parsed = parseLoomManifestRow(row);
    if (parsed.error) { errors.push(parsed.error); continue; }
    const { item } = parsed;
    if (byKey.has(item.sourceKey)) {
      errors.push({ code: 'DUPLICATE_SOURCE', row: item.row, sourceKey: item.sourceKey, error: `The same Loom video is listed on row ${byKey.get(item.sourceKey)}` });
      continue;
    }
    if (byFile.has(item.fileName)) {
      errors.push({ code: 'DUPLICATE_FILE', row: item.row, fileName: item.fileName, error: `The same file is listed on row ${byFile.get(item.fileName)}` });
      continue;
    }
    byKey.set(item.sourceKey, item.row);
    byFile.set(item.fileName, item.row);
    item.file = await inspectMediaFile(root, item.fileName, LOOM_FILE_TYPES);
    item.contentSha256 = item.file.sha256 ? contentSha256(item) : null;
    items.push(item);
  }
  return { root, label, rows: table.rows.length + table.rowErrors.length, items, findings: { errors, warnings } };
}

function emptyReport({ organizationId, importData, apply }) {
  return {
    format: 'ashbi-loom-import-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: apply ? 'live' : 'dry-run',
    organization: { id: organizationId },
    operator: null,
    input: { label: importData.label, rows: importData.rows },
    totals: {
      rows: importData.rows, planned: 0, created: 0, unchanged: 0, deletedInHub: 0, conflicts: 0, skipped: 0,
      plannedBytes: 0, importedBytes: 0,
    },
    files: [],
    projects: [],
    owners: { mapped: 0, unmapped: [] },
    unsupported: [],
    exceptions: {},
    warnings: [...importData.findings.warnings],
    errors: [...importData.findings.errors],
    run: null,
    complete: false,
  };
}

function countsSummary(report) {
  return {
    totals: report.totals,
    projects: report.projects,
    exceptions: report.exceptions,
    unmappedOwners: report.owners.unmapped.length,
    unsupported: report.unsupported.length,
  };
}

/** Resolve the operator: an active staff user of this organization. */
async function loadPeople(db, organizationId, operatorEmail) {
  const users = await db.user.findMany({ where: { organizationId, isActive: true }, select: { id: true, email: true, role: true } });
  const staffByEmail = new Map(users.filter((user) => user.email && STAFF_ROLES.has(user.role)).map((user) => [user.email.toLowerCase(), user.id]));
  const operatorId = staffByEmail.get(normalizeEmail(operatorEmail) ?? '');
  if (!operatorId) throw new OperatorImportError('UNKNOWN_OPERATOR', 'The operator must be an active ADMIN or TEAM user of this organization');
  return { operatorId, staffByEmail };
}

async function planAndWrite(db, context) {
  const { organizationId, importData, report, apply, run, operatorId, staffByEmail, written } = context;
  const items = importData.items;
  const projectIds = [...new Set(items.map((item) => item.projectId))];
  const projects = projectIds.length
    ? await db.project.findMany({ where: { id: { in: projectIds }, organizationId }, select: { id: true } })
    : [];
  const knownProjects = new Set(projects.map((project) => project.id));
  const projectSummary = new Map();
  const summaryFor = (projectId) => {
    if (!projectSummary.has(projectId)) projectSummary.set(projectId, { id: projectId, planned: 0, created: 0, unchanged: 0 });
    return projectSummary.get(projectId);
  };

  const records = await findInChunks(items.map((item) => item.sourceKey), (sourceKeys) => db.loomImportRecord.findMany({
    where: { organizationId, sourceKey: { in: sourceKeys } },
  }));
  const recordByKey = new Map(records.map((record) => [record.sourceKey, record]));
  const attachments = await findInChunks(records.map((record) => record.attachmentId).filter(Boolean), (ids) => db.attachment.findMany({
    where: { id: { in: ids }, organizationId }, select: { id: true, entityType: true, entityId: true, path: true },
  }));
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));

  const attachmentRows = [];
  const recordRows = [];
  const unmappedOwners = new Set();
  const mappedOwners = new Set();
  for (const item of items) {
    const entry = { row: item.row, sourceKey: item.sourceKey, fileName: item.fileName, projectId: item.projectId, size: item.file.size, sha256: item.file.sha256, outcome: null };
    report.files.push(entry);
    const blocking = (code, error) => {
      entry.outcome = 'conflict';
      report.totals.conflicts++;
      report.errors.push({ code, row: item.row, sourceKey: item.sourceKey, error });
    };
    if (!knownProjects.has(item.projectId)) {
      blocking('UNKNOWN_PROJECT', 'project_id was not found in this organization');
      continue;
    }
    const problem = item.file.problem;
    if (problem && !SKIPPED_FILE_CODES.has(problem.code)) {
      blocking(problem.code, problem.error);
      continue;
    }

    const record = recordByKey.get(item.sourceKey);
    if (record) {
      if (record.projectId !== item.projectId) {
        blocking('PROJECT_MAPPING_CHANGED', 'This recording was previously imported into a different project');
        continue;
      }
      const attachment = record.attachmentId ? attachmentById.get(record.attachmentId) : null;
      if (!attachment) {
        // Someone deleted the imported file in the Hub. Respect that: never
        // re-import it, and do not block the rest of the manifest.
        entry.outcome = 'deletedInHub';
        report.totals.deletedInHub++;
        report.warnings.push({ code: 'DELETED_IN_HUB', row: item.row, sourceKey: item.sourceKey, error: 'The imported attachment was deleted in the Hub and is not re-imported' });
        continue;
      }
      if (problem || record.contentSha256 !== item.contentSha256) {
        blocking('SOURCE_CHANGED', 'The manifest row or recording changed since its prior controlled import');
        continue;
      }
      if (isQuarantined(attachment)) {
        report.warnings.push({ code: 'QUARANTINED_IN_HUB', row: item.row, sourceKey: item.sourceKey, error: 'The imported file has since been quarantined' });
      }
      entry.outcome = 'unchanged';
      report.totals.unchanged++;
      summaryFor(item.projectId).unchanged++;
      continue;
    }

    if (problem) {
      // Unsupported, oversized or mismatched content: reported, not imported.
      entry.outcome = 'skipped';
      report.totals.skipped++;
      report.unsupported.push({ code: problem.code, row: item.row, sourceKey: item.sourceKey, fileName: item.fileName, size: item.file.size, error: problem.error });
      continue;
    }

    const ownerUserId = item.ownerEmail ? (staffByEmail.get(item.ownerEmail) ?? null) : null;
    if (ownerUserId) mappedOwners.add(item.ownerEmail);
    else {
      const label = item.ownerEmail ?? item.rawOwnerEmail ?? '(blank)';
      if (!unmappedOwners.has(label)) {
        unmappedOwners.add(label);
        report.warnings.push({ code: 'UNKNOWN_OWNER', ownerEmail: label, error: 'No active Ashbi staff user has this email; the recording is attributed to the operator' });
      }
      report.warnings.push({ code: 'ATTRIBUTED_TO_OPERATOR', row: item.row, sourceKey: item.sourceKey, error: 'Imported as uploaded by the operator' });
    }

    if (!apply) {
      entry.outcome = 'planned';
      report.totals.planned++;
      report.totals.plannedBytes += item.file.size;
      summaryFor(item.projectId).planned++;
      continue;
    }

    // Store through the upload code path (policy re-checked on the exact
    // bytes stored), and refuse if the file changed since it was inspected.
    const buffer = await fs.readFile(item.file.path);
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== item.file.sha256) {
      blocking('FILE_CHANGED_DURING_IMPORT', 'The file changed while the import was running');
      continue;
    }
    const storedResult = await storeValidatedUpload({ filename: item.fileName, mimetype: item.file.mimeType, toBuffer: async () => buffer });
    if (storedResult.error) {
      blocking('INVALID_CONTENT', storedResult.error);
      continue;
    }
    const { stored } = storedResult;
    written.push(stored.path);
    const attachmentId = crypto.randomUUID();
    attachmentRows.push({
      id: attachmentId,
      organizationId,
      filename: stored.filename,
      // The Loom title is what people recognise in the project's files.
      originalName: `${item.title.replace(/[\\/.]+/g, ' ').trim().slice(0, TITLE_MAX) || 'Loom recording'}${item.file.ext}`,
      mimeType: stored.mimeType,
      size: stored.size,
      path: stored.path,
      entityType: 'PROJECT',
      entityId: item.projectId,
      uploadedById: ownerUserId ?? operatorId,
      createdAt: item.createdAt,
    });
    recordRows.push({
      id: crypto.randomUUID(), organizationId, projectId: item.projectId, runId: run.id, attachmentId,
      sourceKey: item.sourceKey, loomUrl: item.loomUrl, title: item.title, sourceCreatedAt: item.createdAt,
      ownerEmail: item.ownerEmail, ownerUserId, fileName: item.fileName, fileSize: item.file.size,
      fileSha256: item.file.sha256, contentSha256: item.contentSha256, outcome: 'IMPORTED',
    });
    entry.outcome = 'created';
    report.totals.created++;
    report.totals.importedBytes += item.file.size;
    summaryFor(item.projectId).created++;
  }
  report.projects = [...projectSummary.values()];
  report.owners = { mapped: mappedOwners.size, unmapped: [...unmappedOwners].sort() };
  if (!apply) return;
  await insertInChunks(attachmentRows, (rows) => db.attachment.createMany({ data: rows }));
  await insertInChunks(recordRows, (rows) => db.loomImportRecord.createMany({ data: rows }));
}

function finishExceptions(report) {
  report.exceptions = countBy([...report.errors, ...report.warnings.filter((warning) => warning.code !== 'ATTRIBUTED_TO_OPERATOR'), ...report.unsupported]);
}

/**
 * Plan (apply=false) or apply (apply=true) a Loom manifest for one
 * organization. `db` should be a tenant-scoped Prisma client (runTenantJob);
 * every query also names `organizationId` explicitly.
 */
export async function runLoomImport(db, { organizationId, importData, operatorEmail, apply = false }) {
  if (!organizationId) throw new OperatorImportError('MISSING_ORGANIZATION', 'organizationId is required');
  const report = emptyReport({ organizationId, importData, apply });
  const { operatorId, staffByEmail } = await loadPeople(db, organizationId, operatorEmail);
  report.operator = { id: operatorId };
  const context = { organizationId, importData, report, apply, run: null, operatorId, staffByEmail, written: [] };

  if (!apply) {
    await planAndWrite(db, context);
    finishExceptions(report);
    report.complete = report.errors.length === 0;
    return report;
  }

  if (report.errors.length) { finishExceptions(report); throw new OperatorImportBlockedError(report); }
  try {
    await db.$transaction(async (transaction) => {
      context.run = await transaction.importRun.create({
        data: { organizationId, source: LOOM_IMPORT_SOURCE, status: 'APPLIED', sourceLabel: importData.label },
      });
      await planAndWrite(transaction, context);
      finishExceptions(report);
      if (report.errors.length) throw new OperatorImportBlockedError(report);
      await transaction.importRun.update({
        where: { id: context.run.id },
        data: { createdCount: report.totals.created, summary: countsSummary(report) },
      });
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    // The transaction rolled back: remove every file this run stored.
    for (const storedPath of context.written) await unlinkStoredUpload(storedPath).catch(() => {});
    throw error;
  }
  report.run = { id: context.run.id };
  report.complete = true;
  await recordAuditEvent(db, {
    organizationId, actorType: 'SYSTEM', action: 'migration_import.applied', entityId: context.run.id,
    metadata: { source: LOOM_IMPORT_SOURCE, created: report.totals.created, unchanged: report.totals.unchanged, skipped: report.totals.skipped },
  });
  return report;
}

/**
 * Remove exactly the attachments (database rows and stored files) a live run
 * created, then its reconciliation records. Refused while any review session
 * uses one of the files: that review is later work, and a reviewed file is
 * kept as evidence.
 */
export async function rollbackLoomImportRun(db, { organizationId, runId }) {
  if (!organizationId || !runId) throw new OperatorImportError('MISSING_ARGUMENT', 'organizationId and runId are required');
  const result = await db.$transaction(async (transaction) => {
    // Serialise rollbacks (and cleanup retries) of this run: the status and
    // pending-file list below are read under the lock.
    await lockImportRun(transaction, runId);
    const run = await transaction.importRun.findFirst({ where: { id: runId, organizationId, source: LOOM_IMPORT_SOURCE } });
    if (!run) throw new OperatorImportError('RUN_NOT_FOUND', 'Import run was not found in this organization');
    if (run.status === 'ROLLED_BACK') {
      const pending = pendingRollbackFiles(run);
      if (!pending.length) throw new OperatorImportError('ALREADY_ROLLED_BACK', 'Import run was already rolled back');
      return { retry: true, attachments: 0, records: 0, paths: pending };
    }
    const records = await transaction.loomImportRecord.findMany({ where: { organizationId, runId }, select: { attachmentId: true } });
    const attachmentIds = records.map((record) => record.attachmentId).filter(Boolean);
    // Hold the attachments until the deletes: a review session created on one
    // after this check would otherwise be deleted with it.
    await lockRowsForUpdate(transaction, 'attachments', attachmentIds);
    const reviewed = await findInChunks(attachmentIds, (ids) => transaction.reviewSession.findMany({
      where: { attachmentId: { in: ids } }, select: { id: true },
    }));
    if (reviewed.length) {
      throw new OperatorImportError('ROLLBACK_BLOCKED', `${reviewed.length} review session(s) use files from this run; remove those reviews first`);
    }
    const attachments = await findInChunks(attachmentIds, (ids) => transaction.attachment.findMany({
      where: { id: { in: ids }, organizationId }, select: { id: true, path: true },
    }));
    const removed = await findInChunks(attachmentIds, async (ids) => [await transaction.attachment.deleteMany({ where: { id: { in: ids }, organizationId } })]);
    const removedRecords = await transaction.loomImportRecord.deleteMany({ where: { organizationId, runId } });
    const paths = attachments.map((attachment) => attachment.path);
    // The paths are recorded with the ROLLED_BACK status, so file cleanup
    // stays retryable after this commit (removeRolledBackFiles).
    await transaction.importRun.update({
      where: { id: runId },
      data: { status: 'ROLLED_BACK', rolledBackAt: new Date(), summary: summaryWithPendingFiles(run.summary, paths) },
    });
    return {
      retry: false,
      attachments: removed.reduce((sum, outcome) => sum + outcome.count, 0),
      records: removedRecords.count,
      paths,
    };
  }, TRANSACTION_OPTIONS);
  if (!result.retry) {
    await recordAuditEvent(db, {
      organizationId, actorType: 'SYSTEM', action: 'migration_import.rolled_back', entityId: runId,
      metadata: { source: LOOM_IMPORT_SOURCE, deletedAttachments: result.attachments, deletedRecords: result.records },
    });
  }
  // Files go only after the database commit, so a failed rollback keeps them.
  const files = await removeRolledBackFiles(db, { runId, paths: result.paths, unlink: unlinkStoredUpload });
  return {
    format: 'ashbi-loom-import-report', version: 1, generatedAt: new Date().toISOString(),
    mode: 'rollback', organization: { id: organizationId }, run: { id: runId },
    deleted: { attachments: result.attachments, files, records: result.records }, complete: true,
  };
}

