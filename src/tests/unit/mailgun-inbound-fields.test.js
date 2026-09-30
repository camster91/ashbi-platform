import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mailgunInboundEmailData } from '../../routes/mailgun.routes.js';

// The Mailgun inbound route passed Mailgun's own field names (from, text,
// html) to the pipeline, which reads senderEmail, bodyText, bodyHtml...;
// the thread or unmatched email could never be created from that path.

test('Mailgun inbound fields map to the pipeline email shape', () => {
  const data = mailgunInboundEmailData({
    sender: 'jane@client.example',
    from: 'Jane Doe <jane@client.example>',
    recipient: 'hub@agency.example',
    subject: 'Homepage feedback',
    'body-plain': 'Full text\n> quoted',
    'stripped-text': 'Full text',
    'body-html': '<p>Full text</p>',
    'Message-Id': '<abc@mail.example>',
    timestamp: '1790000000',
  });
  assert.deepEqual(data, {
    senderEmail: 'jane@client.example',
    senderName: 'Jane Doe',
    recipient: 'hub@agency.example',
    subject: 'Homepage feedback',
    bodyText: 'Full text',
    bodyHtml: '<p>Full text</p>',
    rawEmail: null,
    messageId: '<abc@mail.example>',
    receivedAt: new Date(1790000000 * 1000),
  });
});

test('missing fields fall back like the generic webhook parser', () => {
  const data = mailgunInboundEmailData({ from: 'bob@x.example', 'body-plain': 'hi' });
  assert.equal(data.senderEmail, 'bob@x.example');
  assert.equal(data.senderName, null);
  assert.equal(data.subject, '(No Subject)');
  assert.equal(data.bodyText, 'hi');
  assert.equal(data.bodyHtml, null);
  assert.ok(data.receivedAt instanceof Date);
});

test('the route hands the mapped fields to the pipeline', () => {
  const source = readFileSync(new URL('../../routes/mailgun.routes.js', import.meta.url), 'utf8');
  assert.match(source, /processEmailPipeline\(\{\s*\.\.\.mailgunInboundEmailData\(body\)/);
  assert.doesNotMatch(source, /processEmailPipeline\(\{\s*from:/);
});
