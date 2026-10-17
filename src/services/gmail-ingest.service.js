import { createHash } from 'node:crypto';
import { z } from 'zod';
import { matchSenderToClient } from './gmail-sync-matcher.js';

const nativeId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const inputSchema = z.object({
  organizationId: z.string().min(1).max(100), mailbox: z.string().trim().toLowerCase().email().max(255),
  providerMessageId: nativeId, providerThreadId: nativeId,
  senderEmail: z.string().trim().email().max(255), senderName: z.string().max(255).nullable(),
  subject: z.string().max(1000), bodyText: z.string().max(50000), receivedAt: z.coerce.date(),
  tags: z.array(z.string().max(50)).max(20), upwork: z.boolean().default(false),
}).strict();

// Historical metadata did not record mailbox identity. Exact JSON matches are
// held for review; neither a substring nor a matching subject proves ownership.
async function hasLegacyOverlap(tx, input) {
  const candidates = await tx.message.findMany({ where: {
    thread: { client: { organizationId: input.organizationId } },
    OR: [{ aiExtracted: { contains: input.providerMessageId } }, { aiExtracted: { contains: input.providerThreadId } }],
  }, select: { aiExtracted: true }, take: 201 });
  if (candidates.length > 200) return true; // Bounded examination cannot prove absence.
  return candidates.some(row => {
    try {
      const data = JSON.parse(row.aiExtracted);
      return data?.source === 'gmail-sync' && !data.mailbox
        && (data.gmailMessageId === input.providerMessageId || data.gmailThreadId === input.providerThreadId);
    } catch { return false; }
  });
}

/** Deployment-owned ingestion only: no network, AI, send, or automatic retry. */
export async function ingestGmailMessage(prisma, rawInput) {
  const input = inputSchema.parse(rawInput);
  return prisma.$transaction(async tx => {
    // LOCK precedes EVERY snapshot-taking query, including advisory SELECT.
    // SHARE fences ordinary client/contact edits and phantom contact inserts;
    // NOWAIT avoids reverse-order writer deadlocks and surfaces a partial scan.
    await tx.$executeRaw`LOCK TABLE clients, contacts IN SHARE MODE NOWAIT`;
    const lock = createHash('sha256').update(JSON.stringify([input.organizationId, input.mailbox, input.providerThreadId])).digest('hex');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    if (!await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } })) throw new Error('GMAIL_INGEST_ORGANIZATION_UNAVAILABLE');
    const identity = { organizationId: input.organizationId, mailbox: input.mailbox, providerMessageId: input.providerMessageId };
    const prior = await tx.gmailIngestReceipt.findFirst({ where: identity });
    if (prior) return { replay: true, outcome: prior.outcome };
    const base = { ...identity, providerThreadId: input.providerThreadId };
    const hold = async outcome => {
      await tx.gmailIngestReceipt.create({ data: { ...base, outcome } });
      return { replay: false, outcome };
    };
    if (await hasLegacyOverlap(tx, input)) return hold('HELD_LEGACY_OVERLAP');

    // Resolve against fresh, tenant-scoped live records in the same Serializable
    // transaction as storage. Concurrent remaps can abort; callers report partial.
    const match = input.upwork ? null : await matchSenderToClient(tx, input.organizationId, input.senderEmail);
    const previous = await tx.gmailIngestReceipt.findFirst({ where: {
      organizationId: input.organizationId, mailbox: input.mailbox,
      providerThreadId: input.providerThreadId, outcome: 'MESSAGE',
    }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    let thread = null;
    if (previous) {
      if (!match?.client || match.client.id !== previous.clientId) return hold('HELD_MAPPING_CHANGE');
      thread = await tx.thread.findFirst({ where: {
        id: previous.threadId, clientId: match.client.id,
        client: { organizationId: input.organizationId, deletedAt: null, status: { in: ['ACTIVE', 'PROSPECT'] }, relationshipStatus: { notIn: ['ARCHIVED', 'CHURNED'] } },
        OR: [{ projectId: null }, { project: { clientId: match.client.id, organizationId: input.organizationId, deletedAt: null } }],
      } });
      if (!thread) return hold('HELD_MAPPING_CHANGE');
    }
    if (!match?.client) {
      const reason = match?.ambiguous ? 'ambiguous-client' : input.upwork ? 'upwork' : 'unmatched-client';
      const item = await tx.emailTriageItem.create({ data: {
        organizationId: input.organizationId, subject: input.subject || '(no subject)', senderEmail: input.senderEmail,
        senderName: input.senderName, bodyText: input.bodyText, tags: JSON.stringify([...input.tags, reason]),
        status: 'PENDING', aiSummary: `Gmail sync: ${reason}; manual review required`,
      } });
      await tx.gmailIngestReceipt.create({ data: { ...base, outcome: 'TRIAGE', triageItemId: item.id } });
      return { replay: false, outcome: 'TRIAGE' };
    }
    if (!thread) thread = await tx.thread.create({ data: {
      clientId: match.client.id, subject: input.subject || '(no subject)', status: 'OPEN', lastActivityAt: input.receivedAt,
      priority: input.tags.includes('urgent') ? 'HIGH' : 'NORMAL', matchConfidence: match.confidence,
      matchReason: 'Gmail sync: unique client identity', needsTriage: match.confidence < 0.85 || input.tags.includes('lead'),
    } });
    const message = await tx.message.create({ data: {
      threadId: thread.id, direction: 'INBOUND', senderEmail: input.senderEmail, senderName: input.senderName,
      subject: input.subject, bodyText: input.bodyText, receivedAt: input.receivedAt,
      aiExtracted: JSON.stringify({ source: 'gmail-sync', mailbox: input.mailbox,
        gmailMessageId: input.providerMessageId, gmailThreadId: input.providerThreadId, tags: input.tags }),
    } });
    // Native mail can arrive out of order. Compare in the database so an older
    // delivery cannot replace newer activity, including under concurrent scans.
    await tx.thread.updateMany({ where: { id: thread.id, lastActivityAt: { lt: input.receivedAt } },
      data: { lastActivityAt: input.receivedAt } });
    // Urgency is independent of chronology; an older urgent message still wins.
    if (input.tags.includes('urgent')) await tx.thread.update({ where: { id: thread.id }, data: { priority: 'HIGH' } });
    await tx.gmailIngestReceipt.create({ data: {
      ...base, outcome: 'MESSAGE', clientId: match.client.id, threadId: thread.id, messageId: message.id,
    } });
    return { replay: false, outcome: 'MESSAGE' };
  }, { isolationLevel: 'Serializable', timeout: 15000 });
}
