// Intentional template fallbacks keep working when AI is refused, and log a
// warning with the error code only, never provider text or prompt content
// (#413 security review N8). The same change in POST /api/gmail/draft-reply
// is not exercised here: that route's body schema (gmailDraftReplySchema)
// strips the hubThreadId it reads, so it answers 400 before reaching AI.
import assert from 'node:assert/strict';
import test from 'node:test';

const aiClient = (await import('../../ai/client.js')).default;
const logger = (await import('../../utils/logger.js')).default;
const { AiDisabledError } = await import('../../ai/errors.js');
const { generateProposal } = await import('../../agents/proposal-builder.agent.js');

const SECRET_TEXT = 'provider-echo-of-private-client-notes';

function refusal() {
  const err = new AiDisabledError('organization');
  err.message = `${err.message} ${SECRET_TEXT}`;
  return err;
}

test('proposal builder falls back to the template and warns with the code only', async (t) => {
  const warnings = [];
  const originalWarn = logger.warn;
  const originalChatJSON = aiClient.chatJSON;
  logger.warn = (...args) => { warnings.push(args); };
  aiClient.chatJSON = async () => { throw refusal(); };
  t.after(() => { logger.warn = originalWarn; aiClient.chatJSON = originalChatJSON; });

  const proposal = await generateProposal({ name: 'Ada', company: 'Acme', email: 'ada@acme.test', projectType: 'branding', budget: '5000', notes: SECRET_TEXT });
  assert.match(proposal.title, /^Proposal for Ada/);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0][0], { errorCode: 'AI_DISABLED' });
  assert.equal(JSON.stringify(warnings).includes(SECRET_TEXT), false);
});
