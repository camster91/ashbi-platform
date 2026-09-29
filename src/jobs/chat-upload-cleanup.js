// Pending chat upload purge (docs/chat-media.md). Runs hourly on the
// scheduled-maintenance queue: chat files uploaded for a message that was
// never sent (entityType CHAT_PENDING) are deleted, row and bytes, once they
// are older than 24 hours.
//
// Pending uploads carry no tenant data beyond the file itself and every row
// already names its organization, so one unscoped pass covers all tenants
// (the query touches only CHAT_PENDING rows).

import { prisma } from '../config/db.js';
import { purgeStalePendingChatUploads } from '../services/chat-attachment.service.js';

export async function purgePendingChatUploads(db = prisma, options = {}) {
  const result = await purgeStalePendingChatUploads(db, options);
  if (result.examined > 0) console.log(`[chat-upload-cleanup] Purged ${result.purged} of ${result.examined} pending upload(s) older than ${result.cutoff}`);
  if (result.failed > 0) throw new Error(`${result.failed} pending chat upload(s) retained for retry`);
  return result;
}
