// Shared building blocks for the operator-prepared migration importers
// (#414): the Loom manifest importer (docs/loom-migration.md) and the
// MarkUp.io comments importer (docs/markup-migration.md). Neither vendor
// offers a documented bulk export, so the operator prepares a directory with
// the source files and one CSV in a documented template.
//
// Everything here is pure or read-only: strict RFC 4180 CSV parsing, strict
// ISO 8601 timestamps, safe file names inside the input root (no links, no
// traversal), streamed SHA-256 hashes and upload-policy checks that reuse
// src/security/file-upload-policy.js (extension, MIME, magic bytes, 50 MB).
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_UPLOAD_SIZE, validateUploadedFile } from '../security/file-upload-policy.js';
import { sanitizeDisplayText } from './slack-export-import.service.js';

export { sanitizeDisplayText };

/** The CSV file itself is capped; the media files have the upload limit. */
export const MAX_IMPORT_CSV_BYTES = 16 * 1024 * 1024;
export const QUERY_CHUNK = 500;
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 10 * 60_000 };

export class OperatorImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Raised inside a live transaction so every write in it is rolled back. */
export class OperatorImportBlockedError extends Error {
  constructor(report) {
    super('Live import cannot complete with unresolved reconciliation findings');
    this.code = 'IMPORT_BLOCKED';
    this.report = report;
  }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** SHA-256 of a file, streamed so an oversized file is never held in memory. */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Parse RFC 4180 CSV text: comma separated, `"` quoting with `""` escapes,
 * quoted fields may span lines, CRLF or LF line endings, an optional UTF-8
 * BOM. Returns each record with the 1-based line it starts on. Throws on an
 * unterminated quote or a stray quote inside an unquoted field.
 *
 * @param {string} text
 * @returns {{ line: number, values: string[] }[]}
 */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let values = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;
  const endField = () => { values.push(field); field = ''; fieldStarted = false; };
  const endRecord = () => {
    endField();
    // A line with nothing on it is not a record.
    if (!(values.length === 1 && values[0] === '')) records.push({ line: recordLine, values });
    values = [];
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; } else quoted = false;
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (fieldStarted || field) throw new OperatorImportError('INVALID_CSV', `CSV line ${line}: a quote may only start a field`);
      quoted = true;
      fieldStarted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r' && source[index + 1] === '\n') {
      // CRLF: handled by the \n branch.
    } else if (char === '\n' || char === '\r') {
      endRecord();
      line++;
      recordLine = line;
    } else {
      if (fieldStarted && !quoted && source[index - 1] === '"') {
        throw new OperatorImportError('INVALID_CSV', `CSV line ${line}: unexpected text after a closing quote`);
      }
      field += char;
    }
  }
  if (quoted) throw new OperatorImportError('INVALID_CSV', `CSV line ${recordLine}: unterminated quoted field`);
  if (field || fieldStarted || values.length) endRecord();
  return records;
}

/**
 * Parse a CSV with a header row into objects keyed by (trimmed, lowercased)
 * column name. Every `columns` entry must be present in the header; unknown
 * columns are reported, not used. A record with a different number of fields
 * than the header is a row error, never silently padded.
 */
export function readCsvTable(text, { columns, optional = [] }) {
  const records = parseCsv(text);
  if (!records.length) throw new OperatorImportError('INVALID_CSV', 'The CSV file is empty; it needs a header row');
  const header = records[0].values.map((name) => name.trim().toLowerCase());
  const missing = columns.filter((column) => !header.includes(column));
  if (missing.length) throw new OperatorImportError('MISSING_COLUMNS', `The CSV header is missing: ${missing.join(', ')}`);
  const duplicated = header.filter((name, index) => name && header.indexOf(name) !== index);
  if (duplicated.length) throw new OperatorImportError('INVALID_CSV', `The CSV header repeats: ${[...new Set(duplicated)].join(', ')}`);
  const known = new Set([...columns, ...optional]);
  const unknownColumns = header.filter((name) => name && !known.has(name));
  const rows = [];
  const rowErrors = [];
  for (const record of records.slice(1)) {
    if (record.values.length !== header.length) {
      rowErrors.push({ row: record.line, error: `Expected ${header.length} fields, found ${record.values.length}` });
      continue;
    }
    const row = { __line: record.line };
    header.forEach((name, index) => { if (known.has(name)) row[name] = record.values[index].trim(); });
    for (const name of optional) if (!(name in row)) row[name] = '';
    rows.push(row);
  }
  return { rows, rowErrors, unknownColumns };
}

// ISO 8601 date-time with an explicit offset (or Z), as the templates require.
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A Date for an ISO 8601 timestamp with an offset, or null. */
export function parseIsoTimestamp(value) {
  const match = ISO_WITH_OFFSET.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, , month, day, hour, minute, second = '0'] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{1,63}$/;

/** A lowercased email address, or null when blank or malformed. */
export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email && email.length <= 254 && EMAIL.test(email) ? email : null;
}

/**
 * A file name from a CSV row that names a regular file directly inside the
 * input root: no directories, no traversal, no control characters.
 */
export function safeFileName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 255 || name === '.' || name === '..') return null;
  if (/[\\/\0]/.test(name) || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
  return name;
}

/** Resolve an operator-prepared input directory (never a ZIP). */
export async function resolveInputDirectory(inputDir, label) {
  const resolvedInput = path.resolve(String(inputDir ?? ''));
  const inputStat = await fs.stat(resolvedInput).catch(() => null);
  if (!inputStat) throw new OperatorImportError('MISSING_INPUT', `${label} input directory not found: ${resolvedInput}`);
  if (inputStat.isFile() && resolvedInput.toLowerCase().endsWith('.zip')) {
    throw new OperatorImportError('ZIP_NOT_SUPPORTED', 'Extract the archive to a new directory and pass that directory');
  }
  if (!inputStat.isDirectory()) throw new OperatorImportError('NOT_A_DIRECTORY', `Input is not a directory: ${resolvedInput}`);
  const root = await fs.realpath(resolvedInput);
  return { root, label: path.basename(root) };
}

/** Read the CSV at `root/name`: a regular file (not a link), size-capped. */
export async function readInputCsv(root, name) {
  const target = path.join(root, name);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) throw new OperatorImportError('MISSING_FILE', `The input directory is missing ${name}`);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new OperatorImportError('UNSAFE_PATH', `${name} must be a regular file, not a link or directory`);
  if (stat.size > MAX_IMPORT_CSV_BYTES) throw new OperatorImportError('FILE_TOO_LARGE', `${name} exceeds the ${MAX_IMPORT_CSV_BYTES}-byte limit`);
  return fs.readFile(target, 'utf8');
}

/**
 * Inspect one media file named by the CSV against the upload policy, without
 * keeping its bytes: existence (MISSING_FILE), a regular file (UNSAFE_PATH),
 * an allowed extension (`allowed` maps extension to MIME type;
 * UNSUPPORTED_TYPE), the 50 MB limit (FILE_TOO_LARGE, reported and never
 * read into memory) and extension + MIME + magic bytes (INVALID_CONTENT).
 * Every file that exists gets a SHA-256 for reconciliation.
 *
 * @returns {Promise<{ fileName: string, path: string, size: number | null, sha256: string | null, mimeType: string | null, ext: string, problem: null | { code: string, error: string } }>}
 */
export async function inspectMediaFile(root, fileName, allowed) {
  const target = path.join(root, fileName);
  const ext = path.extname(fileName).toLowerCase();
  const base = { fileName, path: target, size: null, sha256: null, mimeType: allowed[ext] ?? null, ext };
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return { ...base, problem: { code: 'MISSING_FILE', error: 'The file named in the CSV is not in the input directory' } };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ...base, problem: { code: 'UNSAFE_PATH', error: 'The file must be a regular file, not a link or directory' } };
  }
  const inspected = { ...base, size: stat.size, sha256: await sha256File(target) };
  if (!allowed[ext]) {
    return { ...inspected, problem: { code: 'UNSUPPORTED_TYPE', error: `File type "${ext || '(none)'}" is not supported by this importer` } };
  }
  if (stat.size > MAX_UPLOAD_SIZE) {
    return { ...inspected, problem: { code: 'FILE_TOO_LARGE', error: `The file is ${stat.size} bytes; the upload limit is ${MAX_UPLOAD_SIZE} bytes (50 MB)` } };
  }
  const validation = validateUploadedFile(fileName, allowed[ext], await fs.readFile(target));
  if (!validation.valid) {
    return { ...inspected, problem: { code: 'INVALID_CONTENT', error: validation.error } };
  }
  return { ...inspected, problem: null };
}

export async function findInChunks(values, query) {
  const results = [];
  for (let index = 0; index < values.length; index += QUERY_CHUNK) {
    const chunk = values.slice(index, index + QUERY_CHUNK);
    if (chunk.length) results.push(...await query(chunk));
  }
  return results;
}

export async function insertInChunks(rows, insert) {
  for (let index = 0; index < rows.length; index += QUERY_CHUNK) {
    await insert(rows.slice(index, index + QUERY_CHUNK));
  }
}

export function countBy(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.code] = (counts[finding.code] ?? 0) + 1;
  return counts;
}
