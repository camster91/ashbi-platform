import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploadedFile } from '../../security/file-upload-policy.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

test('accepts a file whose extension, MIME, and signature agree', () => {
  assert.deepEqual(validateUploadedFile('proof.png', 'image/png', png), {
    valid: true, ext: '.png', mimetype: 'image/png'
  });
});

test('rejects MIME and extension mismatches', () => {
  assert.equal(validateUploadedFile('proof.png', 'text/html', png).valid, false);
});

test('rejects active and double-extension formats', () => {
  assert.equal(validateUploadedFile('payload.svg', 'image/svg+xml', Buffer.from('<svg/>')).valid, false);
  assert.equal(validateUploadedFile('payload.html.png', 'image/png', png).valid, false);
});

test('rejects spoofed signatures and active markup disguised as text', () => {
  assert.equal(validateUploadedFile('proof.png', 'image/png', Buffer.from('<script>alert(1)</script>')).valid, false);
  assert.equal(validateUploadedFile('notes.txt', 'text/plain', Buffer.from('<svg onload=alert(1)>')).valid, false);
});

test('accepts inert text and rejects empty files', () => {
  assert.equal(validateUploadedFile('notes.txt', 'text/plain', Buffer.from('Project notes')).valid, true);
  assert.equal(validateUploadedFile('notes.txt', 'text/plain', Buffer.alloc(0)).valid, false);
});
