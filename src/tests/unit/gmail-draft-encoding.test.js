import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRfc2822EmailWithAttachment } from '../../agents/gmail-draft.agent.js';

// The text part declares quoted-printable, so the body must be encoded:
// a raw "=" or non-ASCII character would otherwise be garbled by mail clients.
const body = 'Total = $1,200 — café';

test('a plain draft encodes its body as quoted-printable', () => {
  const message = buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body);
  assert.match(message, /Content-Transfer-Encoding: quoted-printable/);
  assert.match(message, /Total=20=3D=20\$1,200/);
  assert.doesNotMatch(message, /café/);
  assert.match(message, /caf=C3=A9/);
});

test('a draft with an attachment encodes its text part as quoted-printable', () => {
  const message = buildRfc2822EmailWithAttachment('a@example.test', 'Hi', body, { attachment: Buffer.from('%PDF-1.4') });
  assert.match(message, /Total=20=3D=20\$1,200/);
  assert.doesNotMatch(message, /café/);
  assert.match(message, /caf=C3=A9/);
  assert.match(message, /Content-Type: application\/pdf/);
});
