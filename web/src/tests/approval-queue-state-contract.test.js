import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../pages/ApprovalQueue.jsx'), 'utf8');

describe('Approval Queue workflow-state contract', () => {
  it('distinguishes named loading, failed, and empty collection states', () => {
    expect(source).toContain("import QueryErrorState from '../components/QueryErrorState'");
    expect(source).toContain("import { Button, LoadingState } from '../components/ui'");
    expect(source).toContain('label="Loading approvals\u2026"');
    expect(source).toContain('<QueryErrorState');
    expect(source).toContain('onRetry={fetchApprovals}');
    expect(source).toMatch(/!loadError\s*&&\s*approvals\.length === 0/);
  });

  it('clears stale read errors before retry and blocks overlapping list requests', () => {
    expect(source).toContain('const [isFetching, setIsFetching] = useState(false)');
    expect(source).toContain('if (fetchingRef.current) return;');
    expect(source).toContain("setLoadError('')");
    expect(source).toContain('isRetrying={isFetching}');
  });

  it('stacks the list and detail panels on narrow screens', () => {
    expect(source).toContain('flex-col lg:flex-row');
    expect(source).toContain('w-full lg:w-80');
  });
});
