import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../pages/Settings.jsx'), 'utf8');

describe('Settings workflow-state contract', () => {
  it('uses shared named loading and retryable error states for AI settings', () => {
    expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
    expect(source).toContain('LoadingState');
    expect(source).toContain('label="Loading AI model settings…"');
    expect(source).toContain('message="Failed to load AI model settings"');
    expect(source).toContain('refetchAIProvider');
    expect(source).toContain('refetchModels');
  });

  it('does not render a false empty API-key state after a failed request', () => {
    expect(source).toContain('keysError');
    expect(source).toContain('message="Failed to load API keys"');
    expect(source).toContain('onRetry={refetchKeys}');
    expect(source).toMatch(/!keysError\s*&&\s*keysData\.keys\.length === 0/);
  });

  it('announces API-key mutation failures and prevents duplicate revocation', () => {
    expect(source).toContain('error={deleteMutation.error?.message}');
    expect(source).toContain('pending={deleteMutation.isPending}');
    expect(source).toContain('title="Revoke API key"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('disabled={deleteMutation.isPending}');
    expect(source).toContain('aria-label={`Revoke ${key.name}`}');
  });
});
