import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeDownloadHeaders, validateUpload } from '../../utils/upload-policy.js';
import { fileUpload } from '../../validators/schemas.js';

describe('central upload policy', () => {
  it('rejects SVG active content', () => {
    const result = validateUpload({
      filename: 'logo.svg',
      mimetype: 'image/svg+xml',
      buffer: Buffer.from('<svg onload="alert(1)"></svg>'),
    });
    assert.equal(result.valid, false);
    assert.equal(fileUpload.validate('logo.svg', 'image/svg+xml').valid, false);
  });

  it('rejects mismatched extension and MIME type', () => {
    const result = validateUpload({
      filename: 'invoice.pdf',
      mimetype: 'image/png',
      buffer: Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /match/i);
  });

  it('rejects a forged PDF without a PDF signature', () => {
    const result = validateUpload({
      filename: 'invoice.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('<script>alert(1)</script>'),
    });
    assert.equal(result.valid, false);
    assert.match(result.error, /signature/i);
  });

  it('accepts a matching PNG signature', () => {
    const result = validateUpload({
      filename: 'photo.png',
      mimetype: 'image/png',
      buffer: Buffer.from('\x89PNG\r\n\x1a\nrest', 'binary'),
    });
    assert.deepEqual(result, { valid: true, ext: '.png', mimetype: 'image/png' });
  });

  it('forces downloads and disables MIME sniffing', () => {
    assert.deepEqual(safeDownloadHeaders('client brief.pdf'), {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="client_brief.pdf"',
      'X-Content-Type-Options': 'nosniff',
    });
  });
});
