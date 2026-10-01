// @ts-check
// Files stored under the local upload directory that have no attachment row:
// expense receipts (`/uploads/receipt-<uuid>.<ext>`) and brand logos
// (`/uploads/brand/logo-<uuid>.<ext>`). The record keeps only the URL, so
// these helpers accept nothing but the names the application itself writes,
// open the file without following symbolic links, and serve it through an
// authenticated, tenant-scoped API route (the static `/uploads/*` path is not
// served; it would fall through to the SPA shell).
//
// Writing: `writeUploadThenPersist` writes the file, then runs the database
// write, and removes the new file if that write fails, so a failed request
// never leaves an orphan file behind.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { contentDisposition } from './send-file.js';
import { mimeTypeForExtension } from '../security/file-upload-policy.js';

/** Default upload root (the working directory's `uploads/`). */
export const DEFAULT_UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `POST /api/expenses/upload-receipt` names receipts `receipt-<uuid>.<ext>`. */
export const RECEIPT_FILE_NAME = new RegExp(`^receipt-${UUID}\\.[A-Za-z0-9]{1,10}$`, 'i');
/** `POST /api/brand/logo` names logos `brand/logo-<uuid>.<png|jpg|jpeg|webp>`. */
export const BRAND_LOGO_FILE_NAME = new RegExp(`^logo-${UUID}\\.(?:png|jpe?g|webp)$`, 'i');

const INLINE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * The upload-relative path of an expense receipt URL the application wrote
 * (`/uploads/receipt-<uuid>.<ext>` -> `receipt-<uuid>.<ext>`), or null.
 * @param {unknown} url
 */
export function receiptRelativePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const name = url.slice('/uploads/'.length);
  return RECEIPT_FILE_NAME.test(name) ? name : null;
}

/**
 * The upload-relative path of a brand logo URL the application wrote
 * (`/uploads/brand/logo-<uuid>.<ext>` -> `brand/logo-<uuid>.<ext>`), or null.
 * @param {unknown} url
 */
export function brandLogoRelativePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/brand/')) return null;
  const name = url.slice('/uploads/brand/'.length);
  return BRAND_LOGO_FILE_NAME.test(name) ? `brand/${name}` : null;
}

/**
 * Absolute path of an upload-relative path produced by the helpers above,
 * guaranteed to stay inside `uploadsDir`.
 * @param {string} relativePath
 * @param {string} uploadsDir
 */
function absoluteInside(relativePath, uploadsDir) {
  const root = path.resolve(uploadsDir);
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) return null;
  return { root, absolutePath };
}

/**
 * Open a stored upload for reading: a regular file whose real path is inside
 * the real upload root, opened with O_NOFOLLOW and re-checked on the open
 * descriptor. Resolves to null when the file is missing or not a regular file
 * inside the root. The caller owns (and must close) the handle.
 * @param {string} relativePath from receiptRelativePath / brandLogoRelativePath
 * @param {string} [uploadsDir]
 * @returns {Promise<{ handle: import('node:fs/promises').FileHandle, size: number } | null>}
 */
export async function openStoredUpload(relativePath, uploadsDir = DEFAULT_UPLOADS_DIR) {
  const resolved = absoluteInside(relativePath, uploadsDir);
  if (!resolved) return null;
  try {
    const stat = await fsp.lstat(resolved.absolutePath);
    if (!stat.isFile()) return null;
    const [realFile, realRoot] = await Promise.all([fsp.realpath(resolved.absolutePath), fsp.realpath(resolved.root)]);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') return null;
    throw error;
  }
  let handle;
  try {
    handle = await fsp.open(resolved.absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = /** @type {any} */ (error)?.code;
    if (code === 'ENOENT' || code === 'ELOOP') return null;
    throw error;
  }
  const stat = await handle.stat();
  if (!stat.isFile()) {
    await handle.close();
    return null;
  }
  return { handle, size: stat.size };
}

/**
 * SHA-256 (lowercase hex) and size of a stored upload, or null when it is not
 * a readable regular file inside the upload root.
 * @param {string} relativePath
 * @param {string} [uploadsDir]
 */
export async function hashStoredUpload(relativePath, uploadsDir = DEFAULT_UPLOADS_DIR) {
  const opened = await openStoredUpload(relativePath, uploadsDir);
  if (!opened) return null;
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of opened.handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      size += chunk.length;
    }
  } finally {
    await opened.handle.close();
  }
  return { sha256: hash.digest('hex'), size };
}

/**
 * Send a stored upload. Images are shown inline, everything else downloads;
 * the content type comes from the (validated) extension, never from the
 * request, and is locked with nosniff and a sandboxing CSP. Resolves to null
 * when the file is not available (the caller answers 404).
 * @param {any} reply
 * @param {{ relativePath: string, uploadsDir?: string, fileName?: string, cacheControl?: string }} options
 */
export async function sendStoredUpload(reply, { relativePath, uploadsDir = DEFAULT_UPLOADS_DIR, fileName, cacheControl = 'private, no-cache' }) {
  const mimeType = mimeTypeForExtension(path.extname(relativePath)) ?? 'application/octet-stream';
  const opened = await openStoredUpload(relativePath, uploadsDir);
  if (!opened) return null;
  const disposition = INLINE_MIME_TYPES.has(mimeType) ? 'inline' : 'attachment';
  reply
    .header('Content-Type', mimeType)
    .header('Content-Length', String(opened.size))
    .header('Content-Disposition', contentDisposition(disposition, fileName || path.basename(relativePath)))
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Cache-Control', cacheControl);
  // The stream owns and closes the descriptor.
  return reply.send(opened.handle.createReadStream());
}

/**
 * Write an uploaded file, then persist its database record. If `persist`
 * throws, the new file is removed (best effort) before the error propagates,
 * so a failed database write leaves no orphan file. The file is created with
 * `wx`: an existing file is never overwritten.
 * @template T
 * @param {string} filePath
 * @param {Buffer | Uint8Array} buffer
 * @param {() => Promise<T>} persist
 * @param {{ writeFile?: typeof fsp.writeFile, unlink?: typeof fsp.unlink }} [io] injectable for tests
 * @returns {Promise<T>}
 */
export async function writeUploadThenPersist(filePath, buffer, persist, io = {}) {
  const writeFile = io.writeFile ?? fsp.writeFile;
  const unlink = io.unlink ?? fsp.unlink;
  await writeFile(filePath, buffer, { flag: 'wx' });
  try {
    return await persist();
  } catch (error) {
    await unlink(filePath).catch(() => {});
    throw error;
  }
}

/**
 * Remove a stored brand logo after it was replaced. Only a logo name the
 * application wrote is removed (never a free-text URL that could name some
 * other file); a missing file is ignored.
 * @param {unknown} logoUrl
 * @param {string} [uploadsDir]
 */
export async function removeStoredBrandLogo(logoUrl, uploadsDir = DEFAULT_UPLOADS_DIR) {
  const relativePath = brandLogoRelativePath(logoUrl);
  if (!relativePath) return false;
  const resolved = absoluteInside(relativePath, uploadsDir);
  if (!resolved) return false;
  try {
    const stat = await fsp.lstat(resolved.absolutePath);
    if (!stat.isFile()) return false;
    await fsp.unlink(resolved.absolutePath);
    return true;
  } catch {
    return false;
  }
}
