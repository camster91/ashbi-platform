import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntegrationsSection } from '../pages/Settings';

describe('accounting integrations settings', () => {
  it('shows truthful unavailable states without actionable controls', () => {
    render(<IntegrationsSection />);

    expect(screen.getByText('QuickBooks Online')).toBeInTheDocument();
    expect(screen.getByText('Xero')).toBeInTheDocument();
    expect(screen.getAllByRole('status', { name: '' })).toHaveLength(2);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /connect|sync|disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/connected|sync started|last synced/i)).not.toBeInTheDocument();
  });
});
