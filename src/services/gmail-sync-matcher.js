// @ts-check
// Sender -> client matching for the Gmail sync (scripts/gmail-sync.js).
//
// The synced mailbox belongs to ONE organization (GMAIL_SYNC_ORGANIZATION_ID),
// and the sync writes the thread and the full message body under the matched
// client. Every lookup is therefore confined to that organization's live
// (not soft-deleted) clients: a sender is never filed under another tenant's
// client, whatever its contacts or domains are.

import { insensitiveEquals } from '../utils/insensitive-equals.js';
import { isFreeEmailDomain } from '../utils/client-identity.js';

/**
 * Whether a sender's domain belongs to a client's domain: the same domain, or
 * a subdomain of it (`mail.acme.com` for `acme.com`). Never a substring match:
 * `notacme.com` and `acme.com.evil.test` do not belong to `acme.com`.
 * @param {string} senderDomain
 * @param {string | null | undefined} clientDomain
 */
export function senderDomainMatches(senderDomain, clientDomain) {
  const sender = String(senderDomain || '').trim().toLowerCase();
  const client = String(clientDomain || '').trim().toLowerCase();
  if (!sender || !client) return false;
  return sender === client || sender.endsWith(`.${client}`);
}

/**
 * The client of `organizationId` a sender belongs to, or null.
 * 1. a contact of a live client of the organization with this address (any case);
 * 2. a live client of the organization whose domain is the sender's domain;
 * 3. a live client of the organization whose domain the sender's domain is a
 *    subdomain of (the most specific domain wins).
 * @param {any} prisma raw Prisma client
 * @param {string} organizationId the synced mailbox's organization
 * @param {string} senderEmail
 * @returns {Promise<{ client: any, contact: any, confidence: number } | null>}
 */
export async function matchSenderToClient(prisma, organizationId, senderEmail) {
  if (!organizationId) throw new Error('matchSenderToClient: organizationId is required');
  const email = String(senderEmail || '').trim();
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const liveClient = { organizationId, deletedAt: null };

  const contact = await prisma.contact.findFirst({
    where: { email: insensitiveEquals(email), client: liveClient },
    include: { client: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (contact) return { client: contact.client, contact, confidence: 1.0 };

  if (isFreeEmailDomain(domain)) return null;

  // Client domains are stored lowercased and unique per organization.
  const exact = await prisma.client.findFirst({ where: { ...liveClient, domain } });
  if (exact) return { client: exact, contact: null, confidence: 0.9 };

  const candidates = await prisma.client.findMany({
    where: { ...liveClient, domain: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const parent = candidates
    .filter((client) => senderDomainMatches(domain, client.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
  return parent ? { client: parent, contact: null, confidence: 0.7 } : null;
}
