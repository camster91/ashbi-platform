import { describe, expect, it } from 'vitest';
import { aiErrorToast, apiErrorToast, isAiErrorCode } from '../lib/apiErrorToast';

const AI_UNAVAILABLE = "AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings.";
const write = (status, code, message) => apiErrorToast({ status, message, data: { code } }, undefined);

describe('AI errors in the global toast', () => {
  it('shows the server message for AI errors instead of "Server error"', () => {
    const toast = write(503, 'AI_UNAVAILABLE', AI_UNAVAILABLE);
    expect(toast).toEqual({ title: 'AI unavailable', message: AI_UNAVAILABLE, duration: 0 });
  });

  it('titles each kind of AI error for what it is, and only "off or not set up" stays on screen', () => {
    expect(write(503, 'AI_DISABLED', 'AI features are turned off for this workspace.')).toMatchObject({ title: 'AI unavailable', duration: 0 });
    const budget = write(402, 'AI_BUDGET_EXCEEDED', 'This workspace has reached its monthly AI budget.');
    expect(budget.title).toBe('AI budget reached');
    expect(budget.duration).toBeUndefined();
    const busy = write(502, 'AI_PROVIDER_RATE_LIMIT', 'The AI provider is rate limiting this workspace.');
    expect(busy).toEqual({ title: 'AI is busy', message: expect.stringMatching(/Try again in a minute/) });
    const refused = write(502, 'AI_PROVIDER_INVALID_REQUEST', 'The AI provider rejected the request (check the model name).');
    expect(refused).toEqual({ title: 'AI refused the request', message: 'The AI provider rejected the request (check the model name).' });
    expect(write(504, 'AI_PROVIDER_TIMEOUT', 'slow').title).toBe('AI took too long');
    expect(write(502, 'AI_ANALYSIS_FAILED', 'AI could not analyze this message.').title).toBe('Message not analyzed');
    expect(write(502, 'AI_PROVIDER_UPSTREAM', 'The AI provider is unavailable.').title).toBe('AI request failed');
    for (const code of ['AI_BUDGET_EXCEEDED', 'AI_PROVIDER_RATE_LIMIT', 'AI_PROVIDER_INVALID_REQUEST', 'AI_ANALYSIS_FAILED']) {
      expect(aiErrorToast(code, 'x').duration).toBeUndefined();
    }
  });

  it('leaves other errors and background reads as they were', () => {
    expect(isAiErrorCode('GMAIL_NOT_CONNECTED')).toBe(false);
    expect(apiErrorToast({ status: 503, data: { code: 'OTHER' } }, undefined)).toMatchObject({ title: 'Server error' });
    expect(apiErrorToast({ status: 503, message: AI_UNAVAILABLE, data: { code: 'AI_UNAVAILABLE' } }, () => {})).toBeNull();
  });
});
