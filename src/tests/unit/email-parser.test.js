import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEmail } from '../../utils/emailParser.js';

describe('email parser dependency boundary', () => {
  it('converts an authenticated raw HTML email to readable text', async () => {
    const raw = [
      'From: "Ashbi Client" <client@example.com>',
      'To: hello@ashbi.ca',
      'Subject: Website update',
      'Date: Fri, 28 Aug 2026 12:00:00 -0400',
      'Message-ID: <website-update@example.com>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hello <strong>Ashbi</strong></p>',
    ].join('\r\n');

    const parsed = await parseEmail(raw);

    assert.equal(parsed.senderEmail, 'client@example.com');
    assert.equal(parsed.senderName, 'Ashbi Client');
    assert.equal(parsed.subject, 'Website update');
    assert.match(parsed.bodyText, /Hello Ashbi/);
    assert.equal(parsed.bodyHtml, '<p>Hello <strong>Ashbi</strong></p>');
    assert.match(parsed.headers, /website-update@example\.com/);
  });

  it('preserves multipart text and attachment metadata', async () => {
    const raw = [
      'From: client@example.com',
      'To: hello@ashbi.ca',
      'Subject: Brand files',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="ashbi-boundary"',
      '',
      '--ashbi-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please review the attached wordmark.',
      '--ashbi-boundary',
      'Content-Type: text/plain; name="wordmark.txt"',
      'Content-Disposition: attachment; filename="wordmark.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      'YXNoYmk=',
      '--ashbi-boundary--',
      '',
    ].join('\r\n');

    const parsed = await parseEmail({ raw });

    assert.match(parsed.bodyText, /Please review the attached wordmark/);
    assert.deepEqual(parsed.attachments, [{ filename: 'wordmark.txt', contentType: 'text/plain', size: 5 }]);
  });

  it('rejects an unrecognized payload instead of inventing an email', async () => {
    await assert.rejects(() => parseEmail({ subject: 'Missing sender and content' }), /Unknown email format/);
  });
});
