// Multipart upload with progress (XMLHttpRequest: fetch has no upload
// progress). Used by the chat composers for pending chat uploads
// (docs/chat-media.md).

// Mirrors src/security/file-upload-policy.js: the server re-checks every
// file (extension, MIME type and magic bytes); this only avoids uploading a
// file that is bound to be refused.
export const UPLOAD_TYPES = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
});
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).join(',');
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const MIME_EXTENSIONS = Object.freeze({
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/webm': '.webm', 'video/mp4': '.mp4', 'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
});

function extensionOf(name) {
  const match = /\.[^.]+$/.exec(String(name || ''));
  return match ? match[0].toLowerCase() : '';
}

/**
 * A file the upload policy can accept: one extension only (the server refuses
 * double extensions), an extension for unnamed clipboard images, and a MIME
 * type inferred from the extension when the browser supplied none.
 * Returns `{ file }` or `{ error }`.
 * @param {File} file
 * @param {{ fallbackBase?: string }} [options]
 */
export function prepareUploadFile(file, { fallbackBase = 'attachment' } = {}) {
  if (!file) return { error: 'No file selected.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: `${file.name || 'This file'} is larger than the 50 MB limit.` };
  if (file.size === 0) return { error: `${file.name || 'This file'} is empty.` };
  const baseType = String(file.type || '').split(';')[0].toLowerCase();
  let ext = extensionOf(file.name);
  if (!ext && MIME_EXTENSIONS[baseType]) ext = MIME_EXTENSIONS[baseType];
  if (!UPLOAD_TYPES[ext]) return { error: `${file.name || 'This file'} is not a supported file type.` };
  const rawBase = String(file.name || '').slice(0, file.name && extensionOf(file.name) ? -extensionOf(file.name).length : undefined);
  const base = rawBase.replace(/[\\/]/g, '-').replace(/\./g, '-').trim() || fallbackBase;
  const type = baseType || UPLOAD_TYPES[ext];
  const name = `${base}${ext}`;
  if (name === file.name && type === file.type) return { file };
  return { file: new File([file], name, { type, lastModified: file.lastModified }) };
}

/**
 * POST one file as multipart/form-data with upload progress.
 * @param {string} url
 * @param {File} file
 * @param {{ method?: string, headers?: Record<string, string>, onProgress?: (fraction: number) => void, signal?: AbortSignal, fieldName?: string, fields?: Record<string, string> }} [options]
 *   fields: form fields sent before the file (the server reads them as it
 *   reaches the file part).
 * @returns {Promise<any>} the parsed JSON response
 */
export function uploadFileWithProgress(url, file, { method = 'POST', headers = {}, onProgress, signal, fieldName = 'file', fields = {} } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) if (value) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { body = {}; }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      const error = new Error(body.error || `Upload failed (${xhr.status}).`);
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => {
      const error = new Error('Upload cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append(fieldName, file, file.name);
    xhr.send(form);
  });
}

/** 1536 → "1.5 KB" */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** 'image' | 'video' | 'audio' | 'file' */
export function attachmentKind(mimeType) {
  const base = String(mimeType || '').split(';')[0].toLowerCase();
  if (/^image\/(png|jpeg|gif|webp)$/.test(base)) return 'image';
  if (base === 'video/webm' || base === 'video/mp4') return 'video';
  if (base.startsWith('audio/')) return 'audio';
  return 'file';
}
