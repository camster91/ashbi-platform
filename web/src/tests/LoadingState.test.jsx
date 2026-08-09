import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LoadingState from '../components/ui/LoadingState';

describe('LoadingState', () => {
  it('announces a specific loading label while hiding its spinner', () => {
    const { container } = render(<LoadingState label="Loading invoices…" />);

    expect(screen.getByRole('status', { name: 'Loading invoices…' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading invoices…')).toBeVisible();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
      'animate-spin',
      'motion-reduce:animate-none'
    );
  });

  it('supports compact layout and a safe size fallback', () => {
    const { container } = render(
      <LoadingState label="Refreshing…" size="unsupported" compact data-testid="loading" />
    );

    expect(screen.getByTestId('loading')).not.toHaveClass('min-h-[12rem]');
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('h-8', 'w-8');
  });

  it('supports a surface-specific spinner adapter without changing semantics', () => {
    const { container } = render(
      <LoadingState label="Loading form…" spinnerClassName="border-slate-700 border-t-amber-400" />
    );

    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
      'border-slate-700',
      'border-t-amber-400'
    );
    expect(screen.getByRole('status', { name: 'Loading form…' })).toBeInTheDocument();
  });
});
