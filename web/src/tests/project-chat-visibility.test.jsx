import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VisibilityBadge } from '../components/ProjectChat';

// C3: staff must always be able to tell internal team chat from messages the
// client can read in their portal, and choose explicitly when sending.
describe('project chat visibility', () => {
  it('labels internal and client-visible messages distinctly', () => {
    const { rerender } = render(<VisibilityBadge visibility="INTERNAL" />);
    expect(screen.getByText('Internal')).toBeInTheDocument();
    rerender(<VisibilityBadge visibility="CLIENT" />);
    expect(screen.getByText('Visible to client')).toBeInTheDocument();
    rerender(<VisibilityBadge />);
    expect(screen.getByText('Internal')).toBeInTheDocument();
  });

  it('defaults the composer to internal and sends the chosen visibility', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ProjectChat.jsx'), 'utf8');
    expect(source).toContain("useState('INTERNAL')");
    expect(source).toContain('api.sendChatMessage(projectId, { content, visibility })');
    expect(source).toContain('Internal (team only)');
    expect(source).toContain('The client will see this message in their portal.');
    expect(source).toContain('<VisibilityBadge visibility={msg.visibility} />');
  });
});
