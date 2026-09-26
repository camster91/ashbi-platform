// Media scanning seam for review sessions (#417, docs/media-review.md
// "Scanning seam"). The malware / content scanner vendor is not chosen yet,
// so no scanner is configured and every file is reported as `unscanned`.
//
// Contract for the scanner that plugs in here:
//
//   scan({ attachmentId, organizationId, path, mimeType, size })
//     -> Promise<{ verdict: 'clean' | 'blocked' | 'pending' | 'unscanned', reason?: string }>
//
// - `blocked`: the file must not be put up for review (422 MEDIA_BLOCKED) or
//   served through a client share link (403 MEDIA_BLOCKED, no file).
// - `pending`: a scan is still running; creating a session is refused with
//   409 until it settles, and share-link downloads are withheld.
// - `clean` / `unscanned`: allowed. Once a vendor is chosen, whether
//   `unscanned` is still allowed becomes a policy switch here, not a route
//   change.
//
// The scanner must not log file contents or share-link tokens, and must
// treat its own errors as `pending`, never `clean`.

/** @typedef {{ verdict: 'clean' | 'blocked' | 'pending' | 'unscanned', reason?: string }} ScanResult */

/** @type {null | { scan: (file: object) => Promise<ScanResult> }} */
let configuredScanner = null;

/**
 * Install a scanner (tests, or the future vendor integration at startup).
 * Pass null to remove it.
 */
export function setMediaScanner(scanner) {
  configuredScanner = scanner;
}

/**
 * @param {{ id: string, organizationId: string, path: string, mimeType: string, size: number }} attachment
 * @returns {Promise<ScanResult>}
 */
export async function scanReviewMedia(attachment) {
  if (!configuredScanner) return { verdict: 'unscanned' };
  try {
    const result = await configuredScanner.scan({
      attachmentId: attachment.id,
      organizationId: attachment.organizationId,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
    const verdict = result?.verdict;
    if (verdict === 'clean' || verdict === 'blocked' || verdict === 'pending' || verdict === 'unscanned') {
      return { verdict, ...(result.reason ? { reason: String(result.reason).slice(0, 100) } : {}) };
    }
    return { verdict: 'pending', reason: 'invalid_scanner_result' };
  } catch {
    return { verdict: 'pending', reason: 'scanner_error' };
  }
}
