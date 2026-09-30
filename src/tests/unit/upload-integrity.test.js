// Upload checksums and refused-upload auditing (docs/media-review.md
// "Upload checksums").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isSha256Hex, recordRejectedUpload, sha256Hex } from '../../services/upload-integrity.service.js';
import { storeValidatedUpload } from '../../services/chat-attachment.service.js';

test('sha256Hex is the lowercase hex digest the attachments CHECK constraint accepts', () => {
  const digest = sha256Hex(Buffer.from('abc'));
  assert.equal(digest, createHash('sha256').update('abc').digest('hex'));
  assert.equal(isSha256Hex(digest), true);
  assert.equal(isSha256Hex(digest.toUpperCase()), false);
  assert.equal(isSha256Hex('abc'), false);
});

test('storeValidatedUpload stores the checksum of the bytes it wrote, and describes a refusal', async (t) => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-integrity-'));
  t.after(() => fs.rm(uploadDir, { recursive: true, force: true }));
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('ok')]);
  const { stored } = await storeValidatedUpload({ filename: 'shot.png', mimetype: 'image/png', toBuffer: async () => bytes }, { uploadDir });
  assert.equal(stored.checksumSha256, sha256Hex(bytes));
  assert.equal(sha256Hex(await fs.readFile(path.join(uploadDir, stored.filename))), stored.checksumSha256);

  const refused = await storeValidatedUpload({ filename: 'shot.png', mimetype: 'image/png', toBuffer: async () => Buffer.from('nope') }, { uploadDir });
  assert.equal(refused.stored, undefined);
  assert.deepEqual(refused.rejected, {
    validation: { valid: false, code: 'CONTENT_MISMATCH', error: refused.error },
    filename: 'shot.png', mimeType: 'image/png', size: 4,
  });
});

test('recordRejectedUpload writes codes and sizes only, never the file name', async () => {
  const rows = [];
  const prisma = { auditEvent: { create: async ({ data }) => { rows.push(data); return data; } } };
  const request = { id: 'req-1', ip: '203.0.113.9', user: { id: 'user-1', role: 'TEAM', organizationId: 'org-1' } };
  await recordRejectedUpload(prisma, request, {
    surface: 'attachments',
    validation: { code: 'MIME_MISMATCH', error: 'File MIME type does not match extension ".png"' },
    filename: 'Secret Plans.PNG', mimeType: 'Text/HTML', size: 12, projectId: 'project-1',
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].action, rows[0].entityType, rows[0].entityId, rows[0].actorType, rows[0].actorUserId, rows[0].organizationId],
    ['upload.rejected', 'attachment', null, 'USER', 'user-1', 'org-1'],
  );
  assert.deepEqual(rows[0].metadata, { surface: 'attachments', reason: 'MIME_MISMATCH', mimeType: 'text/html', size: 12, extension: '.png', projectId: 'project-1' });
  assert.equal(JSON.stringify(rows[0]).includes('Secret'), false);
});
