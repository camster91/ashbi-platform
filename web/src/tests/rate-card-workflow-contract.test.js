import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../pages/RateCards.jsx'), 'utf8');

describe('Rate Card workflow contract', () => {
  it('uses shared dialogs and the actual Button loading API', () => {
    expect(source).toContain("import Modal, { ModalFooter } from '../components/Modal'");
    expect(source.match(/<Modal\b/g)).toHaveLength(2);
    expect(source).not.toContain('className="fixed inset-0');
    expect(source).not.toMatch(/<Button\b[^>]*\bisLoading=/);
    expect(source).toContain('loading={isLoading}');
  });

  it('distinguishes rate-card and client request failures from empty data', () => {
    expect(source).toContain('rateCardsError');
    expect(source).toContain('message="Failed to load rate cards"');
    expect(source).toContain('refetchRateCards');
    expect(source).toContain('clientsError');
    expect(source).toContain('message="Failed to load clients"');
    expect(source).toContain('refetchClients');
  });

  it('keeps pending writes open and exposes failures inline', () => {
    expect(source).toContain('if (formPending) return;');
    expect(source).toContain('if (deleteMutation.isPending) return;');
    expect(source).toContain('mutationError={createMutation.error || updateMutation.error}');
    expect(source).toContain('mutationError={deleteMutation.error}');
    expect(source.match(/role="alert"/g).length).toBeGreaterThanOrEqual(2);
  });

  it('names dynamic rate controls and stacks each row on narrow screens', () => {
    expect(source).toContain('aria-label={`Service ${idx + 1} name`}');
    expect(source).toContain('aria-label={`Remove service ${idx + 1}`}');
    expect(source).toContain('grid-cols-1 sm:grid-cols-12');
  });
});
