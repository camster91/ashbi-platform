import path from 'node:path';

// Every refusal carries a stable `code` (INVALID_FILENAME, DOUBLE_EXTENSION, EXTENSION_NOT_ALLOWED,
// MIME_MISMATCH, EMPTY_FILE, TOO_LARGE, CONTENT_MISMATCH) for the
// `upload.rejected` audit event, next to the caller-facing `error` message.

const FILE_TYPES = new Map([
  ['.jpg', ['image/jpeg']], ['.jpeg', ['image/jpeg']], ['.png', ['image/png']],
  ['.gif', ['image/gif']], ['.webp', ['image/webp']], ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']], ['.xls', ['application/vnd.ms-excel']], ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.txt', ['text/plain']], ['.csv', ['text/csv', 'text/plain']],
  ['.heic', ['image/heic']], ['.heif', ['image/heif']],
  ['.psd', ['image/vnd.adobe.photoshop', 'application/x-photoshop']],
  ['.json', ['application/json', 'text/json']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']], ['.mp4', ['video/mp4']], ['.webm', ['video/webm', 'audio/webm']],
  ['.mp3', ['audio/mpeg']], ['.wav', ['audio/wav', 'audio/x-wav']],
]);

const zipExtensions = new Set(['.zip', '.docx', '.xlsx', '.pptx']);
const oleExtensions = new Set(['.doc', '.xls', '.ppt']);
export const ALLOWED_UPLOAD_EXTENSIONS = Object.freeze([...FILE_TYPES.keys()]);
export const ALLOWED_UPLOAD_MIMETYPES = Object.freeze([...new Set([...FILE_TYPES.values()].flat())]);
export const MAX_UPLOAD_SIZE = 64 * 1024 * 1024;
const DANGEROUS_NAME_PART = /^(?:exe|com|bat|cmd|ps1|js|mjs|cjs|vbs|vbe|jse|wsf|wsh|scr|pif|cpl|msi|msp|mst|reg|hta|html|htm|xhtml|svg|php\d*|phtml|asp|aspx|jsp|jar|sh|bash|zsh|py|rb|pl|dll|so|dylib|url|lnk|scf|sct|cgi)$/i;

/**
 * The canonical MIME type of an allowlisted extension (`.png` -> `image/png`),
 * or null. Used to serve stored files that keep no MIME type of their own
 * (expense receipts, brand logos): the extension was checked against the
 * content when the file was stored.
 * @param {string} ext
 */
export function mimeTypeForExtension(ext) {
  return FILE_TYPES.get(String(ext || '').toLowerCase())?.[0] ?? null;
}

const startsWith = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);

export function validateUploadMetadata(filename, mimetype) {
  // Preserve ordinary original basenames verbatim; never silently strip paths.
  // eslint-disable-next-line no-control-regex -- Explicitly refuse control bytes in original basenames.
  if (typeof filename !== 'string' || !filename || Buffer.byteLength(filename, 'utf8') > 255 || /[/\\:\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(filename) || /[. ]$/.test(filename) || /^\.+$/.test(filename)) return { valid: false, code: 'INVALID_FILENAME', error: 'Choose a valid original filename without paths or control characters' };
  const safeName = filename;
  if (safeName.split('.').slice(1, -1).some(part => DANGEROUS_NAME_PART.test(part))) return { valid: false, code: 'DOUBLE_EXTENSION', error: 'Executable or active-content double extensions are not allowed' };
  const ext = path.extname(safeName).toLowerCase();
  const allowedMimes = FILE_TYPES.get(ext);
  if (!allowedMimes) return { valid: false, code: 'EXTENSION_NOT_ALLOWED', error: `File extension "${ext || '(none)'}" is not allowed` };
  if (!allowedMimes.includes((mimetype || '').toLowerCase())) return { valid: false, code: 'MIME_MISMATCH', error: `File MIME type does not match extension "${ext}"` };
  return { valid: true, ext, mimetype: mimetype.toLowerCase() };
}

// Signature/structure checks only: accepting an original never decodes or
// converts it and never claims full media integrity. Downloads retain guards.
function heifSignature(buffer) {
  let count = 0;
  function boxes(start, end) {
    const result = [];
    while (start < end) {
      if (++count > 512 || end - start < 8) return null;
      let size = buffer.readUInt32BE(start), header = 8;
      if (size === 1) { if (end - start < 16) return null; const wide = buffer.readBigUInt64BE(start + 8); if (wide > BigInt(end - start)) return null; size = Number(wide); header = 16; }
      if (size === 0) size = end - start;
      if (size < header || size > end - start) return null;
      result.push({ type: buffer.toString('latin1', start + 4, start + 8), start: start + header, end: start + size }); start += size;
    }
    return result;
  }
  const top = boxes(0, buffer.length); if (!top) return false;
  const ftyp = top.filter(box => box.type === 'ftyp'), metas = top.filter(box => box.type === 'meta');
  if (ftyp.length !== 1 || metas.length !== 1 || top[0] !== ftyp[0]) return false;
  const brand = ftyp[0]; if (brand.end - brand.start < 12 || (brand.end - brand.start) % 4) return false;
  const brands = [buffer.toString('latin1', brand.start, brand.start + 4)];
  for (let at = brand.start + 8; at < brand.end; at += 4) brands.push(buffer.toString('latin1', at, at + 4));
  const hevc = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'];
  if (![...hevc, 'mif1', 'msf1'].includes(brands[0]) || !brands.some(value => hevc.includes(value))) return false;
  const meta = metas[0]; if (meta.end - meta.start < 4 || buffer.readUInt32BE(meta.start) !== 0) return false;
  const children = boxes(meta.start + 4, meta.end); if (!children || !['pitm', 'iinf', 'iloc', 'iprp'].every(type => children.filter(box => box.type === type).length === 1)) return false;
  return top.some(box => box.type === 'mdat' && box.end > box.start) || children.some(box => box.type === 'idat' && box.end > box.start);
}

function psdSignature(buffer) {
  if (buffer.length < 41 || buffer.toString('latin1', 0, 4) !== '8BPS' || buffer.readUInt16BE(4) !== 1 || !buffer.subarray(6, 12).every(byte => byte === 0)) return false;
  const channels = buffer.readUInt16BE(12), height = buffer.readUInt32BE(14), width = buffer.readUInt32BE(18), depth = buffer.readUInt16BE(22), mode = buffer.readUInt16BE(24);
  if (channels < 1 || channels > 56 || !width || !height || width > 30000 || height > 30000 || ![1, 8, 16, 32].includes(depth) || ![0, 1, 2, 3, 4, 7, 8, 9].includes(mode)) return false;
  let at = 26;
  for (let section = 0; section < 3; section++) { if (buffer.length - at < 4) return false; const size = buffer.readUInt32BE(at); at += 4; if (size > buffer.length - at) return false; at += size; }
  if (buffer.length - at < 3) return false;
  const compression = buffer.readUInt16BE(at); at += 2;
  if (![0, 1, 2, 3].includes(compression)) return false;
  return compression !== 0 || buffer.length - at >= Math.ceil(width * depth / 8) * height * channels;
}

function textContent(buffer, csv) {
  try {
    const little = buffer[0] === 0xff && buffer[1] === 0xfe, big = buffer[0] === 0xfe && buffer[1] === 0xff;
    if ((little || big) && (!csv || buffer.length % 2)) return null;
    const text = new TextDecoder(little ? 'utf-16le' : big ? 'utf-16be' : 'utf-8', { fatal: true }).decode(buffer);
    return text.includes('\0') ? null : text;
  } catch { return null; }
}

export function validateUploadBuffer(buffer, { ext }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { valid: false, code: 'EMPTY_FILE', error: 'File is empty' };
  if (buffer.length > MAX_UPLOAD_SIZE) return { valid: false, code: 'TOO_LARGE', error: 'File exceeds the 64 MiB limit' };
  let valid = false;
  if (ext === '.jpg' || ext === '.jpeg') valid = startsWith(buffer, [0xff, 0xd8, 0xff]);
  else if (ext === '.png') valid = startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (ext === '.gif') valid = ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  else if (ext === '.webp') valid = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  else if (ext === '.pdf') valid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  else if (zipExtensions.has(ext)) valid = startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]);
  else if (oleExtensions.has(ext)) valid = startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  else if (ext === '.mp4') valid = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  else if (ext === '.heic' || ext === '.heif') valid = heifSignature(buffer);
  else if (ext === '.psd') valid = psdSignature(buffer);
  else if (ext === '.json') {
    // JSON is inert attachment data: valid strings may legitimately contain
    // source markup. Bare HTML/script and invalid UTF8/JSON remain refused.
    const text = textContent(buffer, false);
    if (text !== null) try { JSON.parse(text); valid = true; } catch { /* mismatch */ }
  }
  // WebM is an EBML container. Browser MediaRecorder output starts with the
  // EBML header; accepting it allows screen recordings without accepting an
  // arbitrary file renamed to .webm.
  else if (ext === '.webm') valid = startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  else if (ext === '.mp3') valid = buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  else if (ext === '.wav') valid = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  else if (ext === '.txt' || ext === '.csv') {
    const text = textContent(buffer, ext === '.csv');
    valid = text !== null && !/<\s*(?:script|html|svg|iframe|object|embed)\b/i.test(text);
  }
  return valid ? { valid: true } : { valid: false, code: 'CONTENT_MISMATCH', error: `File content does not match extension "${ext}"` };
}

export function validateUploadedFile(filename, mimetype, buffer) {
  const metadata = validateUploadMetadata(filename, mimetype);
  if (!metadata.valid || buffer === undefined) return metadata;
  const content = validateUploadBuffer(buffer, metadata);
  return content.valid ? metadata : content;
}
