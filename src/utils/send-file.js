// Serving stored uploads (#417 security review): header-safe download names
// and single byte-range requests for media.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * A Content-Disposition value that is always a valid header: an ASCII
 * `filename` fallback plus the exact name as RFC 5987 `filename*`. Node
 * rejects non-Latin-1 header values, so a raw `日本.png` used to throw.
 * @param {'inline' | 'attachment'} type
 * @param {string} name
 */
export function contentDisposition(type, name) {
  const base = path.basename(String(name || '')) || 'download';
  const ascii = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'download';
  const encoded = encodeURIComponent(base).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Parse a `Range` header against a file size.
 * - no header, or a multi-range request (which RFC 9110 lets a server
 *   ignore): null, send the whole file;
 * - one satisfiable `bytes=` range: `{ start, end }` (inclusive, clamped);
 * - anything else: `{ unsatisfiable: true }` (416).
 * @param {string | undefined} header
 * @param {number} size
 */
export function parseByteRange(header, size) {
  if (header === undefined || header === null || header === '') return null;
  const value = String(header).trim();
  if (/^bytes=.*,/.test(value)) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (match[1] === '' && match[2] === '') || size <= 0) return { unsatisfiable: true };
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return { unsatisfiable: true };
  }
  return { start, end };
}

/**
 * Stream one stored file with the given headers. The read stream is created
 * only after every header is set, so a header problem can never leak an open
 * file descriptor. Resolves to null when the file is missing (the caller
 * answers 404).
 *
 * @param {any} request
 * @param {any} reply
 * @param {{ filepath: string, mimeType: string, fileName: string, disposition: 'inline' | 'attachment', allowRanges?: boolean, headers?: Record<string, string> }} options
 */
export async function sendStoredFile(request, reply, { filepath, mimeType, fileName, disposition, allowRanges = false, headers = {} }) {
  let stat;
  try {
    stat = await fsp.stat(filepath);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
  const range = allowRanges ? parseByteRange(request.headers.range, stat.size) : null;
  if (allowRanges) reply.header('Accept-Ranges', 'bytes');
  if (range?.unsatisfiable) {
    return reply
      .status(416)
      .header('Content-Range', `bytes */${stat.size}`)
      .type('application/json')
      .send({ error: 'Requested range not satisfiable' });
  }
  reply
    .header('Content-Type', mimeType || 'application/octet-stream')
    .header('Content-Disposition', contentDisposition(disposition, fileName))
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox");
  if (range) {
    reply
      .status(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
      .header('Content-Length', String(range.end - range.start + 1));
    return reply.send(fs.createReadStream(filepath, { start: range.start, end: range.end }));
  }
  reply.header('Content-Length', String(stat.size));
  return reply.send(fs.createReadStream(filepath));
}
