import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pipeline = readFileSync(resolve(process.cwd(), 'src/pages/Pipeline.jsx'), 'utf8');
const proposals = readFileSync(resolve(process.cwd(), 'src/pages/Proposals.jsx'), 'utf8');

describe('revenue workflow states', () => {
  it('distinguishes a pipeline request failure from an empty funnel', () => {
    expect(pipeline).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(pipeline).toContain('pipelineError');
    expect(pipeline).toContain('refetchPipeline');
    expect(pipeline).toMatch(/if \(pipelineError\)[\s\S]*<QueryErrorState/);
  });

  it('distinguishes a proposal request failure from an empty proposal list', () => {
    expect(proposals).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(proposals).toContain('proposalsError');
    expect(proposals).toContain('refetchProposals');
    expect(proposals).toMatch(/proposalsError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*proposals\.length === 0/);
  });
});
