import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(resolve(process.cwd(), 'src/components/project/ProjectCommunications.jsx'), 'utf8');
const api = readFileSync(resolve(process.cwd(), 'src/lib/api.js'), 'utf8');

describe('project communications detail workflow', () => {
  it('loads the selected communication by project and communication id', () => {
    expect(api).toContain('getProjectCommunication: (projectId, communicationId)');
    expect(api).toContain('/communications/${communicationId}');
    expect(component).toContain("queryKey: ['project-communication-full', projectId, expandedId]");
    expect(component).toContain('api.getProjectCommunication(projectId, expandedId)');
    expect(component).not.toContain("enabled: false");
  });

  it('keeps list and selected-detail failures distinct and retryable', () => {
    expect(component).toContain("import QueryErrorState from '../QueryErrorState';");
    expect(component).toContain('communicationsError');
    expect(component).toContain('refetchCommunications');
    expect(component).toContain('detailError');
    expect(component).toContain('refetchDetail');
  });

  it('uses an accessible disclosure and semantic theme tokens', () => {
    expect(component).toContain('aria-expanded={isExpanded}');
    expect(component).toContain('aria-controls={`communication-${comm.id}-detail`}');
    expect(component).toContain('id={`communication-${comm.id}-detail`}');
    expect(component).not.toMatch(/(?:text|bg|border|hover:bg|hover:text)-(?:gray|blue|red|green)-\d+/);
    expect(component).not.toContain('bg-white');
    expect(component).toContain('focus-visible:ring-2');
  });
});
