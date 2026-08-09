import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const team = readFileSync(resolve(process.cwd(), 'src/pages/Team.jsx'), 'utf8');
const retainers = readFileSync(resolve(process.cwd(), 'src/pages/Retainers.jsx'), 'utf8');

describe('team workflow states', () => {
  it('distinguishes a team request failure from an empty member list', () => {
    expect(team).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(team).toContain('teamError');
    expect(team).toContain('refetchTeam');
    expect(team).toMatch(/if \(teamError\)[\s\S]*<QueryErrorState/);
  });

  it('shows partial workload and allocation failures with retries', () => {
    for (const token of ['workloadError', 'refetchWorkload', 'allocationsError', 'refetchAllocations']) {
      expect(team).toContain(token);
    }
    expect(team.match(/<QueryErrorState/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('retainer workflow states', () => {
  it('distinguishes a request failure from no retainer plans', () => {
    expect(retainers).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(retainers).toContain('retainersError');
    expect(retainers).toContain('retainersFetching');
    expect(retainers).toMatch(/retainersError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*allRetainers\.length === 0/);
  });
});
