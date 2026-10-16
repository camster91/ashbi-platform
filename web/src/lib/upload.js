// Multipart upload with progress (XMLHttpRequest: fetch has no upload
// progress). Used by the chat composers for pending chat uploads
// (docs/chat-media.md).

// Mirrors src/security/file-upload-policy.js: the server re-checks every
// file (extension, MIME type and magic bytes); this only avoids uploading a
// file that is bound to be refused.
export const UPLOAD_TYPES = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.heic': 'image/heic', '.heif': 'image/heif',
  '.psd': 'image/vnd.adobe.photoshop', '.json': 'application/json',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
});
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).join(',');
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

const MIME_EXTENSIONS = Object.freeze({
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/webm': '.webm', 'video/mp4': '.mp4', 'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
});

function extensionOf(name) {
  const match = /\.[^.]+$/.exec(String(name || ''));
  return match && match.index > 0 ? match[0].toLowerCase() : '';
}

const MIME_ALIASES = Object.freeze({
  '.psd': ['application/x-photoshop'], '.json': ['text/json'],
  '.csv': ['text/plain'], '.zip': ['application/x-zip-compressed'],
  '.webm': ['audio/webm'], '.wav': ['audio/x-wav'],
});
const UNSAFE_NAME = /[\\/:\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const ACTIVE_EXTENSION = /^(?:exe|com|bat|cmd|ps1|js|mjs|cjs|vbs|vbe|jse|wsf|wsh|scr|pif|cpl|msi|msp|mst|reg|hta|html|htm|xhtml|svg|php\d*|phtml|asp|aspx|jsp|jar|sh|bash|zsh|py|rb|pl|dll|so|dylib|url|lnk|scf|sct|cgi)$/i;

/** Preserve original safe names/bytes; generate a name only for unnamed captures. */
export function prepareUploadFile(file, { fallbackBase = 'attachment' } = {}) {
  if (!file) return { error: 'No file selected.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: `${file.name || 'This file'} is larger than the 64 MiB limit.` };
  if (file.size === 0) return { error: `${file.name || 'This file'} is empty.` };
  const baseType = String(file.type || '').split(';')[0].toLowerCase();
  const name = file.name || (MIME_EXTENSIONS[baseType] ? `${fallbackBase}${MIME_EXTENSIONS[baseType]}` : '');
  if (!name || UNSAFE_NAME.test(name) || [...name].some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)) || /[. ]$/.test(name) || /^\.+$/.test(name) || new Blob([name]).size > 255 || name.split('.').slice(1, -1).some(part => ACTIVE_EXTENSION.test(part))) {
    return { error: 'This filename is not safe to upload.' };
  }
  const ext = extensionOf(name);
  if (!UPLOAD_TYPES[ext]) return { error: `${name} is not a supported file type.` };
  if (baseType && baseType !== UPLOAD_TYPES[ext] && !MIME_ALIASES[ext]?.includes(baseType)) {
    return { error: `${name} has a file type that does not match its extension.` };
  }
  const type = baseType || UPLOAD_TYPES[ext];
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
    const prepared = prepareUploadFile(file);
    if (prepared.error) return reject(new Error(prepared.error));
    file = prepared.file;
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
