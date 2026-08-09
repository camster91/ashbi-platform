import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contracts = readFileSync(resolve(process.cwd(), 'src/pages/Contracts.jsx'), 'utf8');

describe('contracts workflow state contract', () => {
  it('distinguishes contract request failure from an empty collection', () => {
    expect(contracts).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(contracts).toMatch(/contracts = \[\][\s\S]*contractsError[\s\S]*refetchContracts[\s\S]*contractsFetching/);
    expect(contracts).toMatch(/contractsError\s*\?\s*\([\s\S]*<QueryErrorState/);
  });

  it('distinguishes proposal loading and failure from no approved proposals', () => {
    expect(contracts).toContain('proposalsLoading');
    expect(contracts).toContain('proposalsError');
    expect(contracts).toContain('refetchProposals');
    expect(contracts).toMatch(/proposalsLoading\s*\?\s*\([\s\S]*Loading approved proposals/);
    expect(contracts).toMatch(/proposalsError\s*\?\s*\([\s\S]*<QueryErrorState/);
  });
});
