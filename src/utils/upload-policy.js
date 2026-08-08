import path from 'node:path';

const MIME_BY_EXTENSION = new Map([
  ['.jpg', ['image/jpeg']], ['.jpeg', ['image/jpeg']],
  ['.png', ['image/png']], ['.gif', ['image/gif']], ['.webp', ['image/webp']],
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']], ['.xls', ['application/vnd.ms-excel']],
  ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.txt', ['text/plain']], ['.csv', ['text/csv', 'text/plain']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']],
  ['.mp4', ['video/mp4']], ['.mp3', ['audio/mpeg']],
  ['.wav', ['audio/wav', 'audio/x-wav']],
]);

const signatures = {
  '.png': buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  '.jpeg': buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  '.gif': buffer => ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
  '.webp': buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  '.pdf': buffer => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  '.zip': buffer => buffer[0] === 0x50 && buffer[1] === 0x4b,
  '.docx': buffer => buffer[0] === 0x50 && buffer[1] === 0x4b,
  '.xlsx': buffer => buffer[0] === 0x50 && buffer[1] === 0x4b,
  '.pptx': buffer => buffer[0] === 0x50 && buffer[1] === 0x4b,
  '.doc': buffer => buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  '.xls': buffer => buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  '.ppt': buffer => buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
};

export const ALLOWED_UPLOAD_EXTENSIONS = Object.freeze([...MIME_BY_EXTENSION.keys()]);
export const ALLOWED_UPLOAD_MIMETYPES = Object.freeze([...new Set([...MIME_BY_EXTENSION.values()].flat())]);
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;

export function validateUploadMetadata(filename, mimetype) {
  const originalName = path.basename(filename || '');
  const ext = path.extname(originalName).toLowerCase();
  if (!originalName || originalName !== filename || originalName.split('.').length !== 2) {
    return { valid: false, error: 'Invalid filename or double extension' };
  }
  const allowedMimes = MIME_BY_EXTENSION.get(ext);
  if (!allowedMimes) return { valid: false, error: `File extension "${ext}" is not allowed` };
  if (!allowedMimes.includes(mimetype)) {
    return { valid: false, error: `File extension and MIME type do not match` };
  }
  return { valid: true, ext, mimetype };
}

export function validateUpload({ filename, mimetype, buffer }) {
  const metadata = validateUploadMetadata(filename, mimetype);
  if (!metadata.valid) return metadata;
  const { ext } = metadata;
  if (!Buffer.isBuffer(buffer)) return { valid: false, error: 'File content is required' };
  if (buffer.length > MAX_UPLOAD_SIZE) return { valid: false, error: 'File exceeds the 50 MB limit' };
  const signatureCheck = signatures[ext];
  if (signatureCheck && !signatureCheck(buffer)) {
    return { valid: false, error: `File signature does not match ${ext}` };
  }
  if (['.txt', '.csv'].includes(ext)) {
    const prefix = buffer.subarray(0, 4096).toString('utf8').toLowerCase();
    if (/<\s*(script|svg|html|iframe|object|embed)\b/.test(prefix)) {
      return { valid: false, error: 'Active content is not allowed' };
    }
  }
  return metadata;
}

export function safeDownloadHeaders(originalName) {
  const safeName = path.basename(originalName || 'download').replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'X-Content-Type-Options': 'nosniff',
  };
}
