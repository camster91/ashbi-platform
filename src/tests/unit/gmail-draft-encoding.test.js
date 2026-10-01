import assert from 'node:assert/strict';
import { test } from 'node:test';

// The API key is read at module load, so set it before importing.
process.env.MATON_API_KEY ||= 'test-key';
const { buildRfc2822EmailWithAttachment, createDraftWithAttachment } = await import('../../agents/gmail-draft.agent.js');

// The text part declares quoted-printable, so the body must be encoded:
// a raw "=" or non-ASCII character would otherwise be garbled by mail clients.
const body = 'Total = $1,200 — café';

function assertEncoded(message) {
  assert.match(message, /Content-Transfer-Encoding: quoted-printable/);
  assert.match(message, /Total=20=3D=20\$1,200/);
  assert.match(message, /caf=C3=A9/);
  assert.doesNotMatch(message, /café/);
}

test('a plain draft encodes its body as quoted-printable', () => {
  assertEncoded(buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body));
});

test('a draft with an attachment encodes its text part as quoted-printable', () => {
  const message = buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body, { attachment: Buffer.from('%PDF-1.4') });
  assertEncoded(message);
  assert.match(message, /Content-Type: application\/pdf/);
});

test('the proposal draft path sends an encoded text part with its PDF', async (t) => {
  let raw;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    raw = JSON.parse(init.body).message.raw;
    return new Response(JSON.stringify({ id: 'draft-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await createDraftWithAttachment('a@example.test', 'Proposal', body, Buffer.from('%PDF-1.4'), 'proposal.pdf');
  const message = Buffer.from(raw.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
  assertEncoded(message);
  assert.match(message, /filename="proposal\.pdf"/);
});
