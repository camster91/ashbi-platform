import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(process.cwd(), 'src/pages/PortalEstimate.jsx'), 'utf8');

describe('portal estimate response workflow', () => {
  it('submits the selected action and records the matching completion state', () => {
    expect(page).toContain("mutationFn: (action) => api.approveEstimateByToken(viewToken, action)");
    expect(page).toContain("setCompleted(action === 'approve' ? 'approved' : 'declined')");
    expect(page).toContain("respondMutation.mutate('approve')");
    expect(page).toContain("respondMutation.mutate('decline')");
  });
});
