import { z } from 'zod';

const summarySchema = z.object({
  version: z.literal(1), scope: z.literal('INBOX_WINDOW'), lookbackHours: z.number().int().min(1).max(168), pages: z.number().int().min(0).max(5), listed: z.number().int().min(0).max(1000),
  stored: z.number().int().min(0).max(1000), replayed: z.number().int().min(0).max(1000),
  skipped: z.number().int().min(0).max(1000), held: z.number().int().min(0).max(1000),
  errors: z.number().int().min(0).max(1000), partial: z.boolean(),
}).strict();

/** Parse only the last machine record, never return arbitrary child output. */
export function parseGmailSyncSummary(stdout) {
  try {
    const line = String(stdout).trim().split('\n').at(-1);
    if (!line.startsWith('GMAIL_SYNC_SUMMARY ')) return null;
    return summarySchema.parse(JSON.parse(line.slice('GMAIL_SYNC_SUMMARY '.length)));
  } catch { return null; }
}

/** A bounded rolling inbox scan; neither a history cursor nor a backfill. */
export async function scanGmailInbox({ fetchPage, processMessage, query, lookbackHours = 48 }) {
  const result = { version: 1, scope: 'INBOX_WINDOW', lookbackHours, pages: 0, listed: 0, stored: 0, replayed: 0, skipped: 0, held: 0, errors: 0, partial: false };
  let pageToken;
  const tokens = new Set();
  const ids = new Set();
  do {
    const page = await fetchPage({ query, pageToken, maxResults: 200 });
    result.pages++;
    if (!Array.isArray(page.messages ?? []) || (page.messages?.length ?? 0) > 200) throw new Error('GMAIL_SCAN_INVALID_PAGE');
    for (const message of page.messages ?? []) {
      if (typeof message?.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(message.id)) { result.errors++; continue; }
      if (ids.has(message.id)) continue;
      ids.add(message.id); result.listed++;
      try {
        const outcome = await processMessage(message.id);
        if (outcome.skipped) result.skipped++;
        else if (outcome.replay) { result.replayed++; if (outcome.outcome?.startsWith('HELD_')) result.held++; }
        else if (outcome.outcome?.startsWith('HELD_')) result.held++;
        else result.stored++;
      } catch { result.errors++; }
    }
    pageToken = page.nextPageToken;
    if (pageToken != null && (typeof pageToken !== 'string' || pageToken.length > 4096 || !pageToken.length)) throw new Error('GMAIL_SCAN_INVALID_PAGE_TOKEN');
    if (pageToken && tokens.has(pageToken)) { result.partial = true; break; }
    if (pageToken) tokens.add(pageToken);
  } while (pageToken && result.pages < 5);
  result.partial ||= Boolean(pageToken) || result.errors > 0 || result.held > 0;
  return summarySchema.parse(result);
}
