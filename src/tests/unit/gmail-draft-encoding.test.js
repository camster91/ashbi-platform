import assert from 'node:assert/strict';
import { test } from 'node:test';

// The API key is read at module load, so set it before importing.
process.env.MATON_API_KEY ||= 'test-key';
const { buildRfc2822EmailWithAttachment, createDraftWithAttachment, createDraft } = await import('../../agents/gmail-draft.agent.js');

// The text part declares base64, so any text (an "=", non-ASCII) survives
// unchanged in every mail client.
const body = 'Total = $1,200 — café';

function headersOf(message) {
  return message.split('\r\n\r\n')[0].split('\r\n');
}

function textPart(message) {
  const match = message.match(/Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/);
  assert.ok(match, 'a base64 text part');
  return Buffer.from(match[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
}

function assertEncoded(message) {
  assert.equal(textPart(message), body);
  assert.doesNotMatch(message, /café/);
  assert.doesNotMatch(message, /quoted-printable/);
}

function decodeRaw(raw) {
  return Buffer.from(raw.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
}

test('a plain draft encodes its body as base64', () => {
  assertEncoded(buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body));
});

test('a draft with an attachment encodes its text part as base64', () => {
  const message = buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body, { attachment: Buffer.from('%PDF-1.4') });
  assertEncoded(message);
  assert.match(message, /Content-Type: application\/pdf/);
});

test('header injection: CR/LF and control characters cannot add headers, and From is only the mailbox', () => {
  const to = 'a@example.test\r\nBcc: spy@evil.test';
  const subject = 'Hello\r\nFrom: ceo@evil.test\nBcc: spy@evil.test\u0000\u0007';
  for (const options of [{}, { attachment: Buffer.from('%PDF-1.4'), attachmentName: 'p.pdf"\r\nX-Evil: 1' }]) {
    const message = buildRfc2822EmailWithAttachment(to, subject, body, { ...options, from: 'pat@studio.test\r\nFrom: ceo@evil.test' });
    const headers = headersOf(message);
    assert.equal(headers.filter((line) => /^from:/i.test(line)).length, 1);
    assert.equal(headers.filter((line) => /^bcc:/i.test(line)).length, 0);
    assert.ok(headers.find((line) => line.startsWith('From: ')).startsWith('From: pat@studio.test'));
    assert.equal(headers.find((line) => line.startsWith('To: ')), 'To: a@example.test Bcc: spy@evil.test');
    assert.equal(headers.find((line) => line.startsWith('Subject: ')), 'Subject: Hello From: ceo@evil.test Bcc: spy@evil.test');
    assert.ok(!message.includes('\u0000') && !message.includes('\u0007'), 'no control characters');
    assert.ok(message.split('\r\n').every((line) => !/^(bcc|x-evil):/i.test(line)), 'no injected header line anywhere');
  }
});

test('a draft with no known mailbox has no From (Gmail fills it in), never two', () => {
  const headers = headersOf(buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body));
  assert.equal(headers.filter((line) => /^from:/i.test(line)).length, 0);
});

test('a non-ASCII subject is RFC 2047 encoded', () => {
  const headers = headersOf(buildRfc2822EmailWithAttachment('a@example.test', 'Café — ça va', body, { attachment: Buffer.from('%PDF-1.4') }));
  const subject = headers.find((line) => line.startsWith('Subject: '));
  assert.equal(subject, `Subject: =?UTF-8?B?${Buffer.from('Café — ça va', 'utf8').toString('base64')}?=`);
});

test('the proposal draft path sends an encoded text part with its PDF, from the connected mailbox', async (t) => {
  let raw;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/profile')) {
      return new Response(JSON.stringify({ emailAddress: 'pat@studio.test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    raw = JSON.parse(init.body).message.raw;
    return new Response(JSON.stringify({ id: 'draft-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await createDraftWithAttachment('a@example.test', 'Proposal', body, Buffer.from('%PDF-1.4'), 'proposal.pdf');
  const message = decodeRaw(raw);
  assertEncoded(message);
  assert.match(message, /filename="proposal\.pdf"/);
  assert.deepEqual(headersOf(message).filter((line) => /^from:/i.test(line)), ['From: pat@studio.test']);
});

test('a plain draft cannot be given extra headers through its subject', async (t) => {
  let raw;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/profile')) return new Response('{}', { status: 404 });
    raw = JSON.parse(init.body).message.raw;
    return new Response(JSON.stringify({ id: 'draft-2' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await createDraft('a@example.test', 'Hi\r\nBcc: spy@evil.test', body);
  const message = decodeRaw(raw);
  assert.equal(headersOf(message).filter((line) => /^bcc:/i.test(line)).length, 0);
  assertEncoded(message);
});
