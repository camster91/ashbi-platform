import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

describe('legacy API-key route', () => {
  it('sends the obsolete plugin key URL to WordPress Sites instead of a 404', () => {
    expect(app).toContain('<Route path="/api-keys" element={<Navigate to="/wp-sites" replace />} />');
  });
});
