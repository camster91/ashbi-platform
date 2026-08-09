import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const clients = readFileSync(resolve(process.cwd(), 'src/pages/Clients.jsx'), 'utf8');

describe('clients production data source contract', () => {
  it('does not retain the obsolete hardcoded client fallback', () => {
    expect(clients).not.toContain('ASHBI_DESIGN_CLIENTS');
    expect(clients).not.toMatch(/id:\s*'ashbi-client-[1-6]'/);
  });
});
