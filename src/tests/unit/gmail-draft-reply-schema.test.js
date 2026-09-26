import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gmailDraftReplySchema } from '../../validators/schemas.js';

// #464: the route reads request.body.hubThreadId, and the web client sends
// exactly { hubThreadId }. The validator must keep that key, not strip it.
test('gmail draft-reply accepts the body the web client sends', () => {
  const hubThreadId = 'cjld2cjxh0000qzrmn831i7rn';
  const result = gmailDraftReplySchema.safeParse({ hubThreadId });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.equal(result.data.hubThreadId, hubThreadId);
});

test('gmail draft-reply rejects a request without a thread', () => {
  assert.equal(gmailDraftReplySchema.safeParse({}).success, false);
  assert.equal(gmailDraftReplySchema.safeParse({ body: 'hello' }).success, false);
});
