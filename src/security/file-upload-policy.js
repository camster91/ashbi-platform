import path from 'node:path';

const FILE_TYPES = new Map([
  ['.jpg', ['image/jpeg']], ['.jpeg', ['image/jpeg']], ['.png', ['image/png']],
  ['.gif', ['image/gif']], ['.webp', ['image/webp']], ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']], ['.xls', ['application/vnd.ms-excel']], ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.txt', ['text/plain']], ['.csv', ['text/csv', 'text/plain']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']], ['.mp4', ['video/mp4']], ['.webm', ['video/webm', 'audio/webm']],
  ['.mp3', ['audio/mpeg']], ['.wav', ['audio/wav', 'audio/x-wav']],
]);

const zipExtensions = new Set(['.zip', '.docx', '.xlsx', '.pptx']);
const oleExtensions = new Set(['.doc', '.xls', '.ppt']);
export const ALLOWED_UPLOAD_EXTENSIONS = Object.freeze([...FILE_TYPES.keys()]);
export const ALLOWED_UPLOAD_MIMETYPES = Object.freeze([...new Set([...FILE_TYPES.values()].flat())]);
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

const startsWith = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);

export function validateUploadMetadata(filename, mimetype) {
  const safeName = path.basename(filename || '');
  if ((safeName.match(/\./g) || []).length > 1) return { valid: false, error: 'Double extensions are not allowed' };
  const ext = path.extname(safeName).toLowerCase();
  const allowedMimes = FILE_TYPES.get(ext);
  if (!allowedMimes) return { valid: false, error: `File extension "${ext || '(none)'}" is not allowed` };
  if (!allowedMimes.includes((mimetype || '').toLowerCase())) return { valid: false, error: `File MIME type does not match extension "${ext}"` };
  return { valid: true, ext, mimetype: mimetype.toLowerCase() };
}

export function validateUploadBuffer(buffer, { ext }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { valid: false, error: 'File is empty' };
  if (buffer.length > MAX_UPLOAD_SIZE) return { valid: false, error: 'File exceeds the 50 MB limit' };
  let valid = false;
  if (ext === '.jpg' || ext === '.jpeg') valid = startsWith(buffer, [0xff, 0xd8, 0xff]);
  else if (ext === '.png') valid = startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (ext === '.gif') valid = ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  else if (ext === '.webp') valid = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  else if (ext === '.pdf') valid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  else if (zipExtensions.has(ext)) valid = startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]);
  else if (oleExtensions.has(ext)) valid = startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  else if (ext === '.mp4') valid = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  // WebM is an EBML container. Browser MediaRecorder output starts with the
  // EBML header; accepting it allows screen recordings without accepting an
  // arbitrary file renamed to .webm.
  else if (ext === '.webm') valid = startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  else if (ext === '.mp3') valid = buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  else if (ext === '.wav') valid = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  else if (ext === '.txt' || ext === '.csv') {
    const sample = buffer.subarray(0, 8192);
    valid = !sample.includes(0) && !/<\s*(?:script|html|svg|iframe|object|embed)\b/i.test(sample.toString('utf8'));
  }
  return valid ? { valid: true } : { valid: false, error: `File content does not match extension "${ext}"` };
}

export function validateUploadedFile(filename, mimetype, buffer) {
  const metadata = validateUploadMetadata(filename, mimetype);
  if (!metadata.valid || buffer === undefined) return metadata;
  const content = validateUploadBuffer(buffer, metadata);
  return content.valid ? metadata : content;
}
