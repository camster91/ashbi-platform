// Controlled, one-way import of MarkUp.io review comments into Ashbi media
// review (#414). Playbook: docs/markup-migration.md.
//
// MarkUp.io has no documented bulk export, so the operator prepares a
// directory with the reviewed source files (images and PDFs) and a
// `markup-comments.csv` in the documented template. Each distinct
// (markup_project, file_name) becomes one review session on a project
// attachment in the target project (--project-id), internal by default
// (sharedWithClient = false). Each thread root becomes a comment, pinned at
// its normalised x/y when it has one, with its replies and open/resolved
// status. Sessions and comments are written with the media review models and
// validated by the same rules as the review API (media-review.service.js) and
// the database CHECK constraints (migration 20260929120000_review_markup).
//
// Same contract as the Slack export importer: a dry run plans without
// writing; a live run writes everything in one transaction and rolls back on
// any blocking finding; every imported session and comment gets a durable
// reconciliation record, so reruns never duplicate and a changed source is
// reported rather than overwritten. Each live run is recorded in
// `import_runs` and can be rolled back by id.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { recordAuditEvent } from './audit-event.service.js';
import { storeValidatedUpload, unlinkStoredUpload } from './chat-attachment.service.js';
import {
  ANNOTATION_BODY_MAX,
  ANNOTATIONS_PER_SESSION_MAX,
  annotationPositionData,
  annotationPositionError,
  mediaKindFor,
  GUEST_NAME_MAX,
  sanitizeGuestName,
  sanitizePlainText,
} from './media-review.service.js';
import { scanReviewMedia } from './media-scan.service.js';
import {
  OperatorImportBlockedError,
  OperatorImportError,
  TRANSACTION_OPTIONS,
  countBy,
  findInChunks,
  lockImportRun,
  lockImportScope,
  lockRowsForUpdate,
  pendingRollbackFiles,
  removeRolledBackFiles,
  summaryWithPendingFiles,
  truncateCodePoints,
  inspectMediaFile,
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

export const MARKUP_IMPORT_SOURCE = 'MARKUP_CSV';
export const MARKUP_COMMENTS_FILE = 'markup-comments.csv';
export const MARKUP_COLUMNS = Object.freeze([
  'markup_project', 'file_name', 'comment_id', 'page', 'x_percent', 'y_percent', 'author_email', 'author_name',
  'comment', 'status', 'created_at', 'thread_id', 'parent_comment_id',
]);
// MarkUp.io reviews images and PDFs; these are the reviewable image and PDF
// types of the upload policy.
export const MARKUP_FILE_TYPES = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
});
const MARKUP_PROJECT_MAX = 200;
const ID_MAX = 200;
const PAGE_MAX = 10000;
const STAFF_ROLES = new Set(['ADMIN', 'TEAM']);
const SKIPPED_FILE_CODES = new Set(['UNSUPPORTED_TYPE', 'FILE_TOO_LARGE', 'INVALID_CONTENT']);
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export { OperatorImportBlockedError as MarkupImportBlockedError, OperatorImportError as MarkupImportError };

const encode = (value) => encodeURIComponent(value);
export function markupSessionKey(markupProject, fileName) {
  return `markup:${encode(markupProject)}/${encode(fileName)}`;
}
export function markupCommentKey(markupProject, fileName, commentId) {
  return `${markupSessionKey(markupProject, fileName)}/${encode(commentId)}`;
}

function sourceId(value) {
  const id = String(value ?? '').trim();
  return id && id.length <= ID_MAX && !/[\p{Cc}\p{Cf}]/u.test(id) ? id : null;
}

/**
 * Parse the pin of a comment from percent coordinates. Both blank: no pin.
 * Otherwise both must be numbers from 0 to 100, normalised to 0..1.
 * Returns `{ pin }` (possibly null) or `{ problem }`.
 */
export function parseMarkupPin(xPercent, yPercent) {
  const x = String(xPercent ?? '').trim();
  const y = String(yPercent ?? '').trim();
  if (!x && !y) return { pin: null };
  if (!NUMBER.test(x) || !NUMBER.test(y)) {
    return { problem: { code: 'INVALID_COORDINATES', error: 'x_percent and y_percent must both be numbers, or both blank' } };
  }
  const nx = Number(x);
  const ny = Number(y);
  if (nx < 0 || nx > 100 || ny < 0 || ny > 100) {
    return { problem: { code: 'COORDINATES_OUT_OF_RANGE', error: 'x_percent and y_percent must be from 0 to 100' } };
  }
  // Rounded so 33.333…% stays stable and inside the unit square.
  const unit = (value) => Math.min(1, Math.max(0, Math.round(value * 1e4) / 1e6));
  return { pin: { x: unit(nx), y: unit(ny) } };
}

function contentSha256(comment) {
  return sha256(JSON.stringify({
    body: comment.body,
    authorEmail: comment.authorEmail,
    authorName: comment.authorName,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
    page: comment.page,
    x: comment.rawX,
    y: comment.rawY,
    threadId: comment.threadId,
    parentCommentId: comment.parentCommentId,
  }));
}

/**
 * Validate one CSV row. Returns the parsed comment, or `{ error }` with a
 * blocking INVALID_ROW / UNSAFE_PATH finding. Coordinate problems are not
 * blocking: the comment is kept and flagged (imported without a pin).
 */
export function parseMarkupCommentRow(row) {
  const problems = [];
  // Never truncate: markup_project is part of the session identity, so two
  // long names sharing a prefix would collapse into one session.
  const markupProject = sanitizeDisplayText(row.markup_project, Infinity);
  if (!markupProject) problems.push('markup_project is required');
  else if ([...markupProject].length > MARKUP_PROJECT_MAX) problems.push(`markup_project is longer than ${MARKUP_PROJECT_MAX} characters`);
  const fileName = safeFileName(row.file_name);
  if (!fileName) return { error: { code: 'UNSAFE_PATH', row: row.__line, error: 'file_name must name a file directly inside the input directory' } };
  const commentId = sourceId(row.comment_id);
  if (!commentId) problems.push(`comment_id is required (at most ${ID_MAX} characters)`);
  const threadId = sourceId(row.thread_id);
  if (!threadId) problems.push(`thread_id is required (at most ${ID_MAX} characters)`);
  const rawParent = String(row.parent_comment_id ?? '').trim();
  const parentCommentId = rawParent ? sourceId(rawParent) : null;
  if (rawParent && !parentCommentId) problems.push('parent_comment_id is not a valid id');
  if (parentCommentId && parentCommentId === commentId) problems.push('a comment cannot reply to itself');
  const rawPage = String(row.page ?? '').trim();
  let page = null;
  if (rawPage) {
    page = /^\d{1,5}$/.test(rawPage) ? Number(rawPage) : NaN;
    if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) problems.push(`page must be blank or a whole number from 1 to ${PAGE_MAX}`);
  }
  const body = sanitizePlainText(row.comment);
  if (!body) problems.push('comment is empty');
  else if (body.length > ANNOTATION_BODY_MAX) problems.push(`comment is longer than ${ANNOTATION_BODY_MAX} characters`);
  const status = String(row.status ?? '').trim().toLowerCase();
  if (status !== 'open' && status !== 'resolved') problems.push('status must be open or resolved');
  const createdAt = parseIsoTimestamp(row.created_at);
  if (!createdAt) problems.push('created_at must be an ISO 8601 timestamp with an offset');
  // The display name is part of the content hash, so it is checked, never cut.
  const rawAuthorName = sanitizePlainText(row.author_name).replace(/\s+/g, ' ').trim();
  if (rawAuthorName.length > GUEST_NAME_MAX) problems.push(`author_name is longer than ${GUEST_NAME_MAX} characters`);
  if (problems.length) return { error: { code: 'INVALID_ROW', row: row.__line, error: problems.join('; ') } };

  const rawEmail = String(row.author_email ?? '').trim();
  const authorEmail = normalizeEmail(rawEmail);
  const authorName = sanitizeGuestName(row.author_name) || (authorEmail ? truncateCodePoints(authorEmail.split('@')[0], GUEST_NAME_MAX) : '') || 'MarkUp reviewer';
  const pin = parseMarkupPin(row.x_percent, row.y_percent);
  const comment = {
    row: row.__line, markupProject, fileName, commentId, threadId, parentCommentId,
    page, body, status, createdAt, authorEmail, authorName,
    rawX: String(row.x_percent ?? '').trim(), rawY: String(row.y_percent ?? '').trim(),
    pin: pin.pin ?? null, pinProblem: pin.problem ?? null,
    sessionKey: markupSessionKey(markupProject, fileName),
    sourceKey: markupCommentKey(markupProject, fileName, commentId),
  };
  comment.contentSha256 = contentSha256(comment);
  return { comment };
}

/**
 * Read an operator-prepared MarkUp.io input directory: `markup-comments.csv`
 * plus the reviewed files it names, grouped into sessions. Files are
 * inspected (size, SHA-256, upload policy) but not kept in memory.
 */
export async function readMarkupImport(inputDir) {
  const { root, label } = await resolveInputDirectory(inputDir, 'MarkUp.io');
  const table = readCsvTable(await readInputCsv(root, MARKUP_COMMENTS_FILE), { columns: MARKUP_COLUMNS });
  const errors = table.rowErrors.map((rowError) => ({ code: 'INVALID_ROW', ...rowError }));
  const warnings = table.unknownColumns.map((column) => ({ code: 'UNKNOWN_COLUMN', column: sanitizeDisplayText(column, 80), error: 'Column is not part of the template and is ignored' }));
  const sessions = new Map();
  const inspected = new Map();
  let comments = 0;
  for (const row of table.rows) {
    const parsed = parseMarkupCommentRow(row);
    if (parsed.error) { errors.push(parsed.error); continue; }
    const { comment } = parsed;
    let session = sessions.get(comment.sessionKey);
    if (!session) {
      if (!inspected.has(comment.fileName)) inspected.set(comment.fileName, await inspectMediaFile(root, comment.fileName, MARKUP_FILE_TYPES));
      session = {
        sourceKey: comment.sessionKey, markupProject: comment.markupProject, fileName: comment.fileName,
        file: inspected.get(comment.fileName), comments: [], byId: new Map(),
      };
      session.kind = mediaKindFor(session.file.mimeType);
      sessions.set(comment.sessionKey, session);
    }
    if (session.byId.has(comment.commentId)) {
      errors.push({ code: 'DUPLICATE_SOURCE', row: comment.row, sourceKey: comment.sourceKey, error: `comment_id is already used on row ${session.byId.get(comment.commentId).row} for this file` });
      continue;
    }
    if (!session.file.problem) {
      if (session.kind === 'image' && comment.page !== null) {
        errors.push({ code: 'INVALID_ROW', row: comment.row, sourceKey: comment.sourceKey, error: 'page must be blank for an image' });
        continue;
      }
      if (session.kind === 'pdf' && !comment.parentCommentId && comment.pin && comment.page === null) {
        errors.push({ code: 'INVALID_ROW', row: comment.row, sourceKey: comment.sourceKey, error: 'A pin on a PDF needs its page' });
        continue;
      }
    }
    session.byId.set(comment.commentId, comment);
    session.comments.push(comment);
    comments++;
  }
  return { root, label, rows: table.rows.length + table.rowErrors.length, comments, sessions: [...sessions.values()], findings: { errors, warnings } };
}

/**
 * Order a session's comments so every parent precedes its replies, and
 * resolve each reply to its thread root (Ashbi threads are one level deep; a
 * reply to a reply joins the same thread). Returns blocking findings for
 * reply cycles.
 */
export function resolveMarkupThreads(session) {
  const errors = [];
  for (const comment of session.comments) {
    comment.rootCommentId = null;
    if (!comment.parentCommentId) continue;
    const seen = new Set([comment.commentId]);
    let cursor = comment;
    while (cursor.parentCommentId && session.byId.has(cursor.parentCommentId)) {
      if (seen.has(cursor.parentCommentId)) {
        errors.push({ code: 'INVALID_ROW', row: comment.row, sourceKey: comment.sourceKey, error: 'Reply chain loops back on itself' });
        cursor = null;
        break;
      }
      seen.add(cursor.parentCommentId);
      cursor = session.byId.get(cursor.parentCommentId);
    }
    if (!cursor) { comment.cycle = true; continue; }
    // cursor is the top of the chain inside this CSV: a root, or a reply
    // whose parent is not in the CSV (resolved later against the ledger).
    comment.rootCommentId = cursor.parentCommentId ? null : cursor.commentId;
    comment.externalParentId = cursor.parentCommentId ? cursor.parentCommentId : null;
    comment.chainTop = cursor.commentId;
  }
  const depth = (comment) => (comment.parentCommentId ? 1 : 0);
  session.comments.sort((left, right) => depth(left) - depth(right) || left.createdAt - right.createdAt || left.row - right.row);
  return errors;
}

function emptyReport({ organizationId, projectId, importData, apply }) {
  return {
    format: 'ashbi-markup-import-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: apply ? 'live' : 'dry-run',
    organization: { id: organizationId },
    project: { id: projectId },
    operator: null,
    input: { label: importData.label, rows: importData.rows, sessions: importData.sessions.length, comments: importData.comments },
    totals: {
      rows: importData.rows,
      sessionsPlanned: 0, sessionsCreated: 0, sessionsUnchanged: 0,
      commentsPlanned: 0, commentsCreated: 0, commentsUnchanged: 0,
      replies: 0, pins: 0, resolved: 0, deletedInHub: 0, conflicts: 0, skipped: 0,
    },
    sessions: [],
    users: { mapped: 0, unmapped: [] },
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
    sessions: report.sessions.map(({ sourceKey, outcome, comments, planned, created, unchanged, skipped, fileSha256 }) => ({
      sourceKey, outcome, comments, planned, created, unchanged, skipped, fileSha256,
    })),
    exceptions: report.exceptions,
    unmappedUsers: report.users.unmapped.length,
    unsupported: report.unsupported.length,
  };
}

async function loadLedger(db, organizationId, importData) {
  const keys = new Set();
  for (const session of importData.sessions) {
    keys.add(session.sourceKey);
    for (const comment of session.comments) {
      keys.add(comment.sourceKey);
      if (comment.parentCommentId && !session.byId.has(comment.parentCommentId)) {
        keys.add(markupCommentKey(session.markupProject, session.fileName, comment.parentCommentId));
      }
    }
  }
  const records = await findInChunks([...keys], (sourceKeys) => db.markupImportRecord.findMany({
    where: { organizationId, sourceKey: { in: sourceKeys } },
  }));
  const recordByKey = new Map(records.map((record) => [record.sourceKey, record]));
  const sessionIds = records.map((record) => record.reviewSessionId).filter(Boolean);
  const sessions = await findInChunks([...new Set(sessionIds)], (ids) => db.reviewSession.findMany({
    where: { id: { in: ids } }, select: { id: true, projectId: true, status: true, attachmentId: true },
  }));
  const annotations = await findInChunks(records.map((record) => record.annotationId).filter(Boolean), (ids) => db.reviewAnnotation.findMany({
    where: { id: { in: ids } }, select: { id: true, parentId: true, sessionId: true },
  }));
  return {
    recordByKey,
    sessionById: new Map(sessions.map((session) => [session.id, session])),
    annotationById: new Map(annotations.map((annotation) => [annotation.id, annotation])),
  };
}

async function planAndWrite(db, context) {
  const { organizationId, projectId, importData, report, apply, run, operatorId, staffByEmail, written, now } = context;
  const project = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!project) {
    report.errors.push({ code: 'UNKNOWN_PROJECT', projectId, error: 'The target project was not found in this organization' });
    return;
  }
  const ledger = await loadLedger(db, organizationId, importData);
  const unmappedAuthors = new Map();
  const mappedAuthors = new Set();

  for (const session of importData.sessions) {
    const summary = {
      sourceKey: session.sourceKey, markupProject: session.markupProject, fileName: session.fileName,
      size: session.file.size, fileSha256: session.file.sha256, outcome: null,
      comments: session.comments.length, planned: 0, created: 0, unchanged: 0, skipped: 0,
    };
    report.sessions.push(summary);
    const blocking = (code, error, extra = {}) => {
      report.totals.conflicts++;
      report.errors.push({ code, error, ...extra });
    };
    const skipAll = () => { summary.skipped += session.comments.length; report.totals.skipped += session.comments.length; };
    for (const finding of resolveMarkupThreads(session)) blocking(finding.code, finding.error, { row: finding.row, sourceKey: finding.sourceKey });

    const problem = session.file.problem;
    if (problem && !SKIPPED_FILE_CODES.has(problem.code)) {
      summary.outcome = 'conflict';
      blocking(problem.code, problem.error, { sourceKey: session.sourceKey, fileName: session.fileName });
      continue;
    }
    const sessionRecord = ledger.recordByKey.get(session.sourceKey);
    let reviewSessionId = null;
    let acceptsNew = true;
    let isNew = false;
    let existingCount = 0;
    if (sessionRecord) {
      if (sessionRecord.projectId !== projectId) {
        summary.outcome = 'conflict';
        blocking('PROJECT_MAPPING_CHANGED', 'This review was previously imported into a different project', { sourceKey: session.sourceKey });
        continue;
      }
      const existing = sessionRecord.reviewSessionId ? ledger.sessionById.get(sessionRecord.reviewSessionId) : null;
      if (!existing) {
        summary.outcome = 'deletedInHub';
        report.totals.deletedInHub++;
        report.warnings.push({ code: 'DELETED_IN_HUB', sourceKey: session.sourceKey, error: 'The imported review session was deleted in the Hub; its comments are not re-imported' });
        skipAll();
        continue;
      }
      if (problem || sessionRecord.contentSha256 !== session.file.sha256) {
        summary.outcome = 'conflict';
        blocking('SOURCE_CHANGED', 'The reviewed file changed since its prior controlled import', { sourceKey: session.sourceKey, fileName: session.fileName });
        continue;
      }
      summary.outcome = 'unchanged';
      report.totals.sessionsUnchanged++;
      reviewSessionId = existing.id;
      let status = existing.status;
      if (apply) {
        // Lock the review for the rest of the import (as lockOpenSession does
        // for a staff comment) and re-read it: a newer version created since
        // the ledger was loaded has closed it, and comments must not be
        // appended to a superseded review. The count below is then exact too.
        await lockRowsForUpdate(db, 'review_sessions', [existing.id]);
        const current = await db.reviewSession.findUnique({ where: { id: existing.id }, select: { status: true } });
        status = current?.status ?? 'closed';
      }
      acceptsNew = status !== 'closed';
      existingCount = await db.reviewAnnotation.count({ where: { sessionId: existing.id } });
    } else if (problem) {
      summary.outcome = 'skipped';
      report.unsupported.push({ code: problem.code, sourceKey: session.sourceKey, fileName: session.fileName, size: session.file.size, comments: session.comments.length, error: problem.error });
      skipAll();
      continue;
    } else {
      isNew = true;
      summary.outcome = apply ? 'created' : 'planned';
      reviewSessionId = crypto.randomUUID();
    }

    // Comments: annotation ids by comment id (this CSV and prior runs).
    const annotationIdByComment = new Map();
    const annotationRows = [];
    const recordRows = [];
    let closedWarned = false;
    for (const comment of session.comments) {
      if (comment.cycle) continue;
      const record = ledger.recordByKey.get(comment.sourceKey);
      if (record) {
        if (record.projectId !== projectId) {
          blocking('PROJECT_MAPPING_CHANGED', 'This comment was previously imported into a different project', { row: comment.row, sourceKey: comment.sourceKey });
          continue;
        }
        const annotation = record.annotationId ? ledger.annotationById.get(record.annotationId) : null;
        if (!annotation) {
          report.totals.deletedInHub++;
          report.warnings.push({ code: 'DELETED_IN_HUB', row: comment.row, sourceKey: comment.sourceKey, error: 'The imported comment was deleted in the Hub and is not re-imported' });
          continue;
        }
        if (record.contentSha256 !== comment.contentSha256) {
          blocking('SOURCE_CHANGED', 'The comment changed since its prior controlled import', { row: comment.row, sourceKey: comment.sourceKey });
          continue;
        }
        annotationIdByComment.set(comment.commentId, annotation.parentId ?? annotation.id);
        summary.unchanged++;
        report.totals.commentsUnchanged++;
        continue;
      }
      if (!acceptsNew) {
        if (!closedWarned) {
          report.warnings.push({ code: 'SESSION_CLOSED', sourceKey: session.sourceKey, error: 'The review session is closed in the Hub (replaced by a newer version); new comments are not added' });
          closedWarned = true;
        }
        summary.skipped++;
        report.totals.skipped++;
        continue;
      }

      // Thread: the root of this comment's chain, in this CSV or a prior run.
      let parentId = null;
      if (comment.parentCommentId) {
        if (comment.rootCommentId) {
          parentId = annotationIdByComment.get(comment.rootCommentId) ?? null;
        } else if (comment.externalParentId) {
          const parentRecord = ledger.recordByKey.get(markupCommentKey(session.markupProject, session.fileName, comment.externalParentId));
          const parentAnnotation = parentRecord?.annotationId ? ledger.annotationById.get(parentRecord.annotationId) : null;
          parentId = parentAnnotation && parentAnnotation.sessionId === reviewSessionId ? (parentAnnotation.parentId ?? parentAnnotation.id) : null;
        }
        if (!parentId) {
          report.warnings.push({ code: 'PARENT_MISSING', row: comment.row, sourceKey: comment.sourceKey, error: 'The comment this replies to is not in the CSV or the Hub; imported as a top-level comment without a pin' });
        }
      }
      const isReply = Boolean(parentId);
      if (comment.pinProblem && !comment.parentCommentId) {
        report.warnings.push({ code: comment.pinProblem.code, row: comment.row, sourceKey: comment.sourceKey, error: `${comment.pinProblem.error}; imported without a pin` });
      }
      if (comment.parentCommentId && (comment.pin || comment.pinProblem || comment.page !== null)) {
        report.warnings.push({ code: 'REPLY_POSITION_IGNORED', row: comment.row, sourceKey: comment.sourceKey, error: 'Replies have no page or pin in Ashbi; the position is ignored' });
      }
      const pinned = !comment.parentCommentId && comment.pin;
      const position = isReply || comment.parentCommentId
        ? { parentId }
        : { pageNumber: comment.page, ...(pinned ? { region: { x: comment.pin.x, y: comment.pin.y, w: 0, h: 0 }, shape: 'pin' } : {}) };
      const positionError = annotationPositionError(session.kind, { ...position, parentId });
      if (positionError) {
        blocking('INVALID_POSITION', positionError, { row: comment.row, sourceKey: comment.sourceKey });
        continue;
      }

      const staffId = comment.authorEmail ? staffByEmail.get(comment.authorEmail) : null;
      if (staffId) mappedAuthors.add(comment.authorEmail);
      else {
        const identity = `${comment.authorEmail ?? ''}\n${comment.authorName}`;
        if (!unmappedAuthors.has(identity)) {
          unmappedAuthors.set(identity, { email: comment.authorEmail, name: comment.authorName });
          report.warnings.push({ code: 'UNKNOWN_AUTHOR', authorEmail: comment.authorEmail, authorName: comment.authorName, error: 'No active Ashbi staff user has this email; comments are imported under the display name' });
        }
      }
      const id = crypto.randomUUID();
      if (!isReply) annotationIdByComment.set(comment.commentId, id);
      else annotationIdByComment.set(comment.commentId, parentId);
      const resolved = !isReply && comment.status === 'resolved';
      report.totals.replies += isReply ? 1 : 0;
      report.totals.pins += pinned ? 1 : 0;
      report.totals.resolved += resolved ? 1 : 0;
      if (!apply) {
        summary.planned++;
        report.totals.commentsPlanned++;
        continue;
      }
      annotationRows.push({
        id,
        sessionId: reviewSessionId,
        parentId,
        authorType: staffId ? 'staff' : 'guest',
        authorUserId: staffId ?? null,
        authorName: staffId ? (context.staffNameById.get(staffId) || comment.authorName) : comment.authorName,
        authorEmail: staffId ? null : comment.authorEmail,
        body: comment.body,
        ...annotationPositionData({ ...position, parentId }),
        resolvedAt: resolved ? now : null,
        resolvedById: resolved ? operatorId : null,
        createdAt: comment.createdAt,
      });
      recordRows.push({
        id: crypto.randomUUID(), organizationId, projectId, runId: run.id, kind: 'ANNOTATION',
        sourceKey: comment.sourceKey, markupProject: session.markupProject, fileName: session.fileName,
        commentId: comment.commentId, threadId: comment.threadId, reviewSessionId, annotationId: id,
        contentSha256: comment.contentSha256, outcome: 'IMPORTED',
      });
      summary.created++;
      report.totals.commentsCreated++;
    }

    const newComments = apply ? annotationRows.length : summary.planned;
    if (existingCount + newComments > ANNOTATIONS_PER_SESSION_MAX) {
      blocking('TOO_MANY_COMMENTS', `A review session holds at most ${ANNOTATIONS_PER_SESSION_MAX} comments`, { sourceKey: session.sourceKey });
      continue;
    }
    if (isNew && !apply) {
      report.totals.sessionsPlanned++;
      continue;
    }
    if (!apply) continue;

    if (isNew) {
      const buffer = await fs.readFile(session.file.path);
      if (crypto.createHash('sha256').update(buffer).digest('hex') !== session.file.sha256) {
        summary.outcome = 'conflict';
        blocking('FILE_CHANGED_DURING_IMPORT', 'The file changed while the import was running', { sourceKey: session.sourceKey });
        continue;
      }
      const storedResult = await storeValidatedUpload({ filename: session.fileName, mimetype: session.file.mimeType, toBuffer: async () => buffer });
      if (storedResult.error) {
        summary.outcome = 'conflict';
        blocking('INVALID_CONTENT', storedResult.error, { sourceKey: session.sourceKey });
        continue;
      }
      const { stored } = storedResult;
      written.push(stored.path);
      const attachmentId = crypto.randomUUID();
      const scan = await scanReviewMedia({ id: attachmentId, organizationId, path: stored.path, mimeType: stored.mimeType, size: stored.size });
      if (scan.verdict === 'pending') {
        summary.outcome = 'conflict';
        blocking('MEDIA_SCAN_PENDING', 'The file is still being scanned; run the import again shortly', { sourceKey: session.sourceKey });
        continue;
      }
      if (scan.verdict === 'blocked') {
        // Undo this session's file and counts: it is reported, not imported.
        written.pop();
        await unlinkStoredUpload(stored.path);
        summary.outcome = 'skipped';
        report.totals.commentsCreated -= summary.created;
        summary.skipped += summary.created;
        report.totals.skipped += summary.created;
        summary.created = 0;
        report.unsupported.push({ code: 'MEDIA_BLOCKED', sourceKey: session.sourceKey, fileName: session.fileName, comments: session.comments.length, error: 'The file did not pass the media scan' });
        continue;
      }
      await db.attachment.create({
        data: {
          id: attachmentId, organizationId, filename: stored.filename, originalName: session.fileName,
          mimeType: stored.mimeType, size: stored.size, path: stored.path,
          entityType: 'PROJECT', entityId: projectId, uploadedById: operatorId,
        },
      });
      await db.reviewSession.create({
        data: {
          id: reviewSessionId, organizationId, projectId, attachmentId,
          title: truncateCodePoints(sanitizePlainText(`${session.markupProject} — ${session.fileName}`), 200) || 'MarkUp review',
          status: 'open', version: 1, sharedWithClient: false, clientCanDecide: false, createdById: operatorId,
        },
      });
      await db.markupImportRecord.create({
        data: {
          id: crypto.randomUUID(), organizationId, projectId, runId: run.id, kind: 'SESSION',
          sourceKey: session.sourceKey, markupProject: session.markupProject, fileName: session.fileName,
          reviewSessionId, attachmentId, contentSha256: session.file.sha256, fileSha256: session.file.sha256, outcome: 'IMPORTED',
        },
      });
      report.totals.sessionsCreated++;
    }
    // Roots before replies: a reply's parent is always inserted first.
    await insertInChunks(annotationRows, (rows) => db.reviewAnnotation.createMany({ data: rows }));
    await insertInChunks(recordRows, (rows) => db.markupImportRecord.createMany({ data: rows }));
  }
  report.users = { mapped: mappedAuthors.size, unmapped: [...unmappedAuthors.values()] };
}

function finishExceptions(report) {
  report.exceptions = countBy([...report.errors, ...report.warnings, ...report.unsupported]);
}

/** The operator: an active staff user of this organization. */
async function loadPeople(db, organizationId, operatorEmail) {
  const users = await db.user.findMany({ where: { organizationId, isActive: true }, select: { id: true, email: true, role: true, name: true } });
  const staff = users.filter((user) => user.email && STAFF_ROLES.has(user.role));
  const staffByEmail = new Map(staff.map((user) => [user.email.toLowerCase(), user.id]));
  const staffNameById = new Map(staff.map((user) => [user.id, truncateCodePoints(String(user.name || user.email), GUEST_NAME_MAX)]));
  const operatorId = staffByEmail.get(normalizeEmail(operatorEmail) ?? '');
  if (!operatorId) throw new OperatorImportError('UNKNOWN_OPERATOR', 'The operator must be an active ADMIN or TEAM user of this organization');
  return { operatorId, staffByEmail, staffNameById };
}

/**
 * Plan (apply=false) or apply (apply=true) a MarkUp.io comments CSV into one
 * project of one organization. `db` should be a tenant-scoped Prisma client
 * (runTenantJob); every query also names `organizationId` explicitly.
 */
export async function runMarkupImport(db, { organizationId, projectId, importData, operatorEmail, apply = false }) {
  if (!organizationId) throw new OperatorImportError('MISSING_ORGANIZATION', 'organizationId is required');
  if (!projectId) throw new OperatorImportError('MISSING_PROJECT', 'projectId is required');
  const report = emptyReport({ organizationId, projectId, importData, apply });
  const people = await loadPeople(db, organizationId, operatorEmail);
  report.operator = { id: people.operatorId };
  const context = { organizationId, projectId, importData, report, apply, run: null, ...people, written: [], now: new Date() };

  if (!apply) {
    await planAndWrite(db, context);
    finishExceptions(report);
    report.complete = report.errors.length === 0;
    return report;
  }

  if (report.errors.length) { finishExceptions(report); throw new OperatorImportBlockedError(report); }
  try {
    await db.$transaction(async (transaction) => {
      // Before the ledger is read: no concurrent import or rollback of this
      // source in this organization can change it until this run commits.
      await lockImportScope(transaction, MARKUP_IMPORT_SOURCE, organizationId);
      context.run = await transaction.importRun.create({
        data: { organizationId, source: MARKUP_IMPORT_SOURCE, status: 'APPLIED', sourceLabel: importData.label },
      });
      await planAndWrite(transaction, context);
      finishExceptions(report);
      if (report.errors.length) throw new OperatorImportBlockedError(report);
      await transaction.importRun.update({
        where: { id: context.run.id },
        data: { createdCount: report.totals.sessionsCreated + report.totals.commentsCreated, summary: countsSummary(report) },
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
    metadata: {
      source: MARKUP_IMPORT_SOURCE, projectId, sessionsCreated: report.totals.sessionsCreated,
      commentsCreated: report.totals.commentsCreated, commentsUnchanged: report.totals.commentsUnchanged,
    },
  });
  return report;
}

/**
 * Remove exactly the review sessions, comments and stored files a live run
 * created, then its reconciliation records. Refused when later work depends
 * on them: comments or replies not created by this run, decisions, share
 * links, or a newer version of an imported session.
 */
export async function rollbackMarkupImportRun(db, { organizationId, runId }) {
  if (!organizationId || !runId) throw new OperatorImportError('MISSING_ARGUMENT', 'organizationId and runId are required');
  const result = await db.$transaction(async (transaction) => {
    // Serialise against imports of this source (their ledger reads) and, per
    // run, against other rollbacks and cleanup retries: the status and
    // pending-file list below are read under the locks.
    await lockImportScope(transaction, MARKUP_IMPORT_SOURCE, organizationId);
    await lockImportRun(transaction, runId);
    const run = await transaction.importRun.findFirst({ where: { id: runId, organizationId, source: MARKUP_IMPORT_SOURCE } });
    if (!run) throw new OperatorImportError('RUN_NOT_FOUND', 'Import run was not found in this organization');
    if (run.status === 'ROLLED_BACK') {
      const pending = pendingRollbackFiles(run);
      if (!pending.length) throw new OperatorImportError('ALREADY_ROLLED_BACK', 'Import run was already rolled back');
      return { retry: true, comments: 0, sessions: 0, attachments: 0, records: 0, paths: pending };
    }
    const records = await transaction.markupImportRecord.findMany({
      where: { organizationId, runId }, select: { kind: true, reviewSessionId: true, annotationId: true, attachmentId: true },
    });
    const sessionIds = records.filter((record) => record.kind === 'SESSION').map((record) => record.reviewSessionId).filter(Boolean);
    const annotationIds = records.filter((record) => record.kind === 'ANNOTATION').map((record) => record.annotationId).filter(Boolean);
    const attachmentIds = records.filter((record) => record.kind === 'SESSION').map((record) => record.attachmentId).filter(Boolean);
    const runAnnotations = new Set(annotationIds);
    // Every review this run touched, including existing reviews it only added
    // comments to (ANNOTATION records): a reply to one of this run's roots
    // would otherwise be cascaded away with it. Only SESSION records' reviews
    // are deleted.
    const touchedSessionIds = [...new Set(records.map((record) => record.reviewSessionId).filter(Boolean))];
    // Hold the sessions (and their files) until the deletes: every comment,
    // decision, share link or version written to them takes a conflicting
    // lock, so nothing can be added between these checks and the cascade.
    // Attachments first: a new review version's insert takes its foreign-key
    // locks on the attachment before the previous session, so the same order
    // here cannot deadlock against it.
    await lockRowsForUpdate(transaction, 'attachments', attachmentIds);
    await lockRowsForUpdate(transaction, 'review_sessions', touchedSessionIds);

    const blockers = [];
    const foreignInSessions = (await findInChunks(sessionIds, (ids) => transaction.reviewAnnotation.findMany({
      where: { sessionId: { in: ids } }, select: { id: true },
    }))).filter((annotation) => !runAnnotations.has(annotation.id));
    if (foreignInSessions.length) blockers.push(`${foreignInSessions.length} comment(s) not created by this run`);
    const foreignReplies = (await findInChunks(annotationIds, (ids) => transaction.reviewAnnotation.findMany({
      where: { parentId: { in: ids } }, select: { id: true },
    }))).filter((reply) => !runAnnotations.has(reply.id));
    if (foreignReplies.length) blockers.push(`${foreignReplies.length} reply(ies) outside this run`);
    const decisions = await findInChunks(sessionIds, async (ids) => [await transaction.reviewDecision.count({ where: { sessionId: { in: ids } } })]);
    if (decisions.reduce((sum, count) => sum + count, 0)) blockers.push('review decisions');
    const links = await findInChunks(sessionIds, async (ids) => [await transaction.reviewShareLink.count({ where: { sessionId: { in: ids } } })]);
    if (links.reduce((sum, count) => sum + count, 0)) blockers.push('share links');
    const versions = await findInChunks(sessionIds, (ids) => transaction.reviewSession.findMany({ where: { previousSessionId: { in: ids } }, select: { id: true } }));
    if (versions.length) blockers.push('newer versions of imported reviews');
    if (blockers.length) {
      throw new OperatorImportError('ROLLBACK_BLOCKED', `Later work depends on this run (${blockers.join(', ')}); roll back later runs or remove that work first`);
    }

    let comments = 0;
    // Replies first, then roots (a root's delete would cascade its replies).
    for (const parentFilter of [{ not: null }, null]) {
      const outcomes = await findInChunks(annotationIds, async (ids) => [await transaction.reviewAnnotation.deleteMany({ where: { id: { in: ids }, parentId: parentFilter } })]);
      comments += outcomes.reduce((sum, outcome) => sum + outcome.count, 0);
    }
    const sessionOutcomes = await findInChunks(sessionIds, async (ids) => [await transaction.reviewSession.deleteMany({ where: { id: { in: ids } } })]);
    const attachments = await findInChunks(attachmentIds, (ids) => transaction.attachment.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, path: true } }));
    const attachmentOutcomes = await findInChunks(attachmentIds, async (ids) => [await transaction.attachment.deleteMany({ where: { id: { in: ids }, organizationId } })]);
    const removedRecords = await transaction.markupImportRecord.deleteMany({ where: { organizationId, runId } });
    const paths = attachments.map((attachment) => attachment.path);
    // The paths are recorded with the ROLLED_BACK status, so file cleanup
    // stays retryable after this commit (removeRolledBackFiles).
    await transaction.importRun.update({
      where: { id: runId },
      data: { status: 'ROLLED_BACK', rolledBackAt: new Date(), summary: summaryWithPendingFiles(run.summary, paths) },
    });
    return {
      retry: false,
      comments,
      sessions: sessionOutcomes.reduce((sum, outcome) => sum + outcome.count, 0),
      attachments: attachmentOutcomes.reduce((sum, outcome) => sum + outcome.count, 0),
      records: removedRecords.count,
      paths,
    };
  }, TRANSACTION_OPTIONS);
  if (!result.retry) {
    await recordAuditEvent(db, {
      organizationId, actorType: 'SYSTEM', action: 'migration_import.rolled_back', entityId: runId,
      metadata: { source: MARKUP_IMPORT_SOURCE, deletedSessions: result.sessions, deletedComments: result.comments, deletedRecords: result.records },
    });
  }
  // Files go only after the database commit, so a failed rollback keeps them.
  const files = await removeRolledBackFiles(db, { runId, paths: result.paths, unlink: unlinkStoredUpload });
  return {
    format: 'ashbi-markup-import-report', version: 1, generatedAt: new Date().toISOString(),
    mode: 'rollback', organization: { id: organizationId }, run: { id: runId },
    deleted: { sessions: result.sessions, comments: result.comments, attachments: result.attachments, files, records: result.records },
    complete: true,
  };
}
