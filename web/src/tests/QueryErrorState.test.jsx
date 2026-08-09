import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import QueryErrorState, { getQueryErrorGuidance } from '../components/QueryErrorState';

describe('QueryErrorState', () => {
  it.each([
    [false, {}, 'You are offline'],
    [true, { status: 401 }, 'Your session ended'],
    [true, { status: 403 }, 'You do not have access'],
    [true, { status: 404 }, 'This item is no longer available'],
    [true, { status: 409 }, 'A newer change already exists'],
    [true, { status: 422 }, 'Some information needs attention'],
    [true, { status: 429 }, 'Too many requests'],
    [true, { status: 503 }, 'The service could not complete this request'],
  ])('distinguishes online=%s error=%o', (online, error, title) => {
    expect(getQueryErrorGuidance(error, online).title).toBe(title);
  });

  it('announces guidance and offers a keyboard-accessible retry', () => {
    const retry = vi.fn();
    render(<QueryErrorState error={{ status: 503 }} onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Your input has not been cleared');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('prevents duplicate retry requests while retrying', () => {
    render(<QueryErrorState error={{ status: 429 }} onRetry={() => {}} isRetrying />);
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
