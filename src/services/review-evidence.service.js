// @ts-check
// Review evidence export (#417, docs/media-review.md "Evidence export").
//
// One JSON document that keeps a review decision understandable outside the
// product: the review, every version of the reviewed asset (file name, size,
// type and SHA-256 when recorded), every annotation and markup shape with its
// author and timestamps, every decision with its actor, role, comment and
// timestamp, the share links and the review audit trail (link creation and
// revocation, client access changes, decisions, exports).
//
// `prisma` is the request's tenant-scoped client: every query below stays
// inside the caller's organization. Storage paths are never exported (the
// stored file name identifies the file for an operator restoring a backup).

import { createHash } from 'node:crypto';
import {
  ANNOTATIONS_PER_SESSION_MAX,
  loadVersionChain,
  mediaKindFor,
  shareLinkState,
  staffAnnotation,
} from './media-review.service.js';

export const REVIEW_EVIDENCE_FORMAT = 'ashbi.review-evidence';
export const REVIEW_EVIDENCE_FORMAT_VERSION = 1;
const AUDIT_TRAIL_MAX = 2000;

/** "review-evidence-homepage-2026-10-01.json" */
export function reviewEvidenceFileName(session, now = new Date()) {
  const slug = String(session.title || 'review')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'review';
  return `review-evidence-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

function roleFor(actorType, userId, roles) {
  if (actorType === 'guest') return 'GUEST';
  if (actorType === 'client') return 'CLIENT';
  return (userId && roles.get(userId)) || 'STAFF';
}

/**
 * Build the evidence document for a review session the caller may view.
 *
 * @param {any} prisma tenant-scoped Prisma client
 * @param {{ id: string, projectId: string, organizationId?: string } & Record<string, any>} session
 * @param {{ exportedBy: { id: string, name?: string | null, email?: string | null }, now?: Date }} options
 */
export async function buildReviewEvidence(prisma, session, { exportedBy, now = new Date() }) {
  const chain = await loadVersionChain(prisma, session, { projectId: session.projectId });
  const sessionIds = chain.length ? chain.map((row) => row.id) : [session.id];

  const [project, sessions, annotations, decisions, shareLinks] = await Promise.all([
    prisma.project.findFirst({ where: { id: session.projectId }, select: { id: true, name: true, clientId: true } }),
    prisma.reviewSession.findMany({
      where: { id: { in: sessionIds } },
      include: {
        attachment: {
          select: {
            id: true, filename: true, originalName: true, mimeType: true, size: true,
            checksumSha256: true, uploadedById: true, createdAt: true,
          },
        },
      },
    }),
    prisma.reviewAnnotation.findMany({
      where: { sessionId: { in: sessionIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: ANNOTATIONS_PER_SESSION_MAX * sessionIds.length,
    }),
    prisma.reviewDecision.findMany({
      where: { sessionId: { in: sessionIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.reviewShareLink.findMany({
      where: { sessionId: { in: sessionIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const auditEntityIds = [...sessionIds, ...shareLinks.map((link) => link.id)];
  const auditEvents = await prisma.auditEvent.findMany({
    where: { entityId: { in: auditEntityIds }, action: { startsWith: 'review.' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: AUDIT_TRAIL_MAX,
  });

  const actorIds = new Set();
  for (const row of annotations) if (row.authorUserId) actorIds.add(row.authorUserId);
  for (const row of decisions) if (row.actorUserId) actorIds.add(row.actorUserId);
  const users = actorIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, role: true } })
    : [];
  const roles = new Map(users.map((user) => [user.id, user.role]));

  const versionOf = new Map(sessions.map((row) => [row.id, row.version]));
  const orderedSessions = [...sessions].sort((a, b) => a.version - b.version || String(a.id).localeCompare(String(b.id)));

  const versions = orderedSessions.map((row) => ({
    sessionId: row.id,
    version: row.version,
    title: row.title,
    status: row.status,
    current: row.id === session.id,
    previousSessionId: row.previousSessionId ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt,
    sourceUrl: row.sourceUrl ?? null,
    captureViewport: row.captureViewport ?? null,
    asset: row.attachment ? {
      attachmentId: row.attachment.id,
      fileName: row.attachment.originalName,
      storedFileName: row.attachment.filename,
      mimeType: row.attachment.mimeType,
      kind: mediaKindFor(row.attachment.mimeType),
      size: row.attachment.size,
      checksum: row.attachment.checksumSha256 ? { algorithm: 'sha256', value: row.attachment.checksumSha256 } : null,
      uploadedById: row.attachment.uploadedById,
      uploadedAt: row.attachment.createdAt,
    } : null,
  }));

  const evidence = {
    format: REVIEW_EVIDENCE_FORMAT,
    formatVersion: REVIEW_EVIDENCE_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    exportedBy: { userId: exportedBy.id, name: exportedBy.name ?? exportedBy.email ?? null },
    review: {
      id: session.id,
      title: session.title,
      status: session.status,
      version: session.version,
      project: project ? { id: project.id, name: project.name } : { id: session.projectId, name: null },
      sharedWithClient: Boolean(session.sharedWithClient),
      clientCanDecide: Boolean(session.clientCanDecide),
      sourceUrl: session.sourceUrl ?? null,
      captureViewport: session.captureViewport ?? null,
      createdById: session.createdById,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    versions,
    annotations: annotations.map((row) => ({
      ...staffAnnotation(row),
      sessionId: row.sessionId,
      version: versionOf.get(row.sessionId) ?? null,
      authorRole: roleFor(row.authorType, row.authorUserId, roles),
      updatedAt: row.updatedAt,
    })),
    decisions: decisions.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      version: versionOf.get(row.sessionId) ?? null,
      decision: row.decision,
      actorType: row.actorType,
      actorRole: roleFor(row.actorType, row.actorUserId, roles),
      actorUserId: row.actorUserId ?? null,
      actorName: row.actorName,
      actorEmail: row.actorEmail ?? null,
      viaShareLinkId: row.shareLinkId ?? null,
      comment: row.note ?? null,
      createdAt: row.createdAt,
    })),
    shareLinks: shareLinks.map((link) => ({
      id: link.id,
      sessionId: link.sessionId,
      label: link.label ?? null,
      allowDecision: link.allowDecision,
      createdById: link.createdById,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt ?? null,
      revokedById: link.revokedById ?? null,
      lastUsedAt: link.lastUsedAt ?? null,
      state: shareLinkState(link, now),
    })),
    auditTrail: auditEvents.map((event) => ({
      id: event.id,
      action: event.action,
      actorType: event.actorType,
      actorUserId: event.actorUserId ?? null,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? {},
      createdAt: event.createdAt,
    })),
    completeness: {
      versionChainComplete: chain.length === 0 || chain.length === sessions.length,
      annotationsTruncated: annotations.length >= ANNOTATIONS_PER_SESSION_MAX * sessionIds.length,
      auditTrailTruncated: auditEvents.length >= AUDIT_TRAIL_MAX,
      assetsWithoutChecksum: versions.filter((row) => row.asset && !row.asset.checksum).length,
    },
  };
  return evidence;
}

/**
 * Serialize the evidence and hash exactly the bytes sent, so the recipient can
 * check the download against the `X-Evidence-Sha256` header.
 * @param {object} evidence
 */
export function serializeReviewEvidence(evidence) {
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  return { body, sha256: createHash('sha256').update(body).digest('hex') };
}
