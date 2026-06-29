/**
 * AI Client Unit Tests
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzeMessagePrompt } from '../../utils/ai-prompts-proxy.js';

describe('AI Prompt Builders', () => {
  test('buildAnalyzeMessagePrompt should return correct structure', () => {
    const message = { subject: 'Test', senderEmail: 'test@example.com', bodyText: 'Hello' };
    const result = buildAnalyzeMessagePrompt({ message });
    
    assert.ok(result.system, 'Should have system prompt');
    assert.ok(result.prompt, 'Should have user prompt');
    assert.ok(result.prompt.includes('Hello'), 'Prompt should include message body');
    assert.equal(result.temperature, 0.3);
  });
});
