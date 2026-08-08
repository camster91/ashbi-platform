import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DraftRecoveryNotice from '../components/DraftRecoveryNotice';

describe('DraftRecoveryNotice', () => {
  it('offers explicit recovery and discard actions for a stored draft', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    const onDiscard = vi.fn();
    render(
      <DraftRecoveryNotice
        draft={{ title: 'Recovered title' }}
        draftSavedAt="2026-08-07T18:00:00.000Z"
        status="idle"
        onRecover={onRecover}
        onDiscard={onDiscard}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Unsaved draft found');
    await user.click(screen.getByRole('button', { name: 'Recover draft' }));
    expect(onRecover).toHaveBeenCalledWith({ title: 'Recovered title' });
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('announces saving, saved, conflict, and error states accessibly', () => {
    const { rerender } = render(<DraftRecoveryNotice status="saving" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saving draft');

    rerender(<DraftRecoveryNotice status="saved" lastSaved="2026-08-07T18:00:00.000Z" />);
    expect(screen.getByRole('status')).toHaveTextContent('Draft saved');

    rerender(<DraftRecoveryNotice status="conflict" />);
    expect(screen.getByRole('alert')).toHaveTextContent('newer draft');

    const onRetry = vi.fn();
    rerender(<DraftRecoveryNotice status="error" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('button', { name: 'Try saving again' })).toBeInTheDocument();
  });
});
