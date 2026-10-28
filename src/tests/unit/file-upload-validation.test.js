/**
 * File Upload Validation Tests
 *
 * Checks the shared extension and MIME allowlists. Runtime upload policy,
 * byte validation and traversal rejection are covered by file-upload-policy.test.js.
 *
 * Issues #6, #7: No file type validation and path traversal risk on uploads.
 *
 * Run with: node scripts/run-node-tests.mjs src/tests/unit/file-upload-validation.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileUpload } from '../../validators/schemas.js';
const ALLOWED_UPLOAD_EXTENSIONS = fileUpload.ALLOWED_EXTENSIONS;
const ALLOWED_UPLOAD_MIMETYPES = fileUpload.ALLOWED_MIMETYPES;

describe('File Upload Validation', () => {
  describe('Allowlist consistency', () => {
    it('ALLOWED_UPLOAD_EXTENSIONS does not include dangerous extensions', () => {
      const extensions = ALLOWED_UPLOAD_EXTENSIONS;
      const dangerous = ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif',
        '.html', '.htm', '.js', '.mjs', '.vbs', '.ps1',
        '.sh', '.bash', '.php', '.jsp', '.asp', '.aspx',
        '.py', '.rb', '.pl', '.cgi'];

      const found = dangerous.filter(ext => extensions.includes(ext));
      assert.equal(found.length, 0,
        `Dangerous extensions found in allowlist: ${found.join(', ')}`);
    });

    it('ALLOWED_UPLOAD_MIMETYPES does not include dangerous MIME types', () => {
      const mimetypes = ALLOWED_UPLOAD_MIMETYPES;
      const dangerous = [
        'application/x-executable',
        'application/x-msdos-program',
        'text/html',
        'application/javascript',
        'text/javascript',
        'application/x-php',
        'application/x-jsp',
        'application/x-sh',
        'application/x-cgi',
      ];

      const found = dangerous.filter(mime => mimetypes.includes(mime));
      assert.equal(found.length, 0,
        `Dangerous MIME types found in allowlist: ${found.join(', ')}`);
    });

    it('ALLOWED_UPLOAD_EXTENSIONS includes common safe types', () => {
      const extensions = ALLOWED_UPLOAD_EXTENSIONS;
      const expected = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'];

      for (const ext of expected) {
        assert.ok(extensions.includes(ext), `Should allow ${ext}`);
      }
    });

    it('ALLOWED_UPLOAD_MIMETYPES includes common safe MIME types', () => {
      const mimetypes = ALLOWED_UPLOAD_MIMETYPES;
      const expected = ['image/jpeg', 'image/png', 'application/pdf'];

      for (const mime of expected) {
        assert.ok(mimetypes.includes(mime), `Should allow ${mime}`);
      }
    });
  });
});
