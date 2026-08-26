import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Ashbi AI prompts do not invent company proof or public titles', () => {
  const promptSources = [
    '../../routes/ai.routes.js',
    '../../routes/email-triage.routes.js',
    '../../agents/proposal-builder.agent.js',
  ].map(relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')).join('\n');

  for (const unsupportedClaim of [/10\+ years/i, /CEO\/SEO/i, /founder of Ashbi/i]) {
    assert.doesNotMatch(promptSources, unsupportedClaim);
  }
  assert.match(promptSources, /AI and automation are pilot capabilities/i);
});
