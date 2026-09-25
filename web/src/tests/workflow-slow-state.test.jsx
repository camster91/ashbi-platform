import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Button from '../components/ui/Button';
import LoadingState from '../components/ui/LoadingState';
import SlowNotice, { SLOW_GUIDANCE, SLOW_MESSAGE } from '../components/ui/SlowNotice';
import { TablePageSkeleton } from '../components/ui/PageSkeleton';
import QueryErrorState from '../components/QueryErrorState';
import { SLOW_THRESHOLD_MS } from '../hooks/useSlowState';

const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('shared "Slow" workflow state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses an 8 second threshold', () => {
    expect(SLOW_THRESHOLD_MS).toBe(8000);
  });

  it('LoadingState adds slow guidance inside its polite status only after the threshold', () => {
    render(<LoadingState label="Loading invoices…" />);
    const status = screen.getByRole('status', { name: 'Loading invoices…' });

    advance(SLOW_THRESHOLD_MS - 1);
    expect(screen.queryByText(SLOW_MESSAGE)).not.toBeInTheDocument();

    advance(1);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(SLOW_MESSAGE);
    expect(status).toHaveTextContent(SLOW_GUIDANCE.read);
    // Reduced-motion users get no entrance animation.
    expect(status.querySelector('[data-slow-state]')).toHaveClass('motion-reduce:animate-none');
  });

  it('LoadingState can opt out of the slow message', () => {
    render(<LoadingState label="Loading…" slowAfterMs={false} />);
    advance(SLOW_THRESHOLD_MS * 3);
    expect(screen.queryByText(SLOW_MESSAGE)).not.toBeInTheDocument();
  });

  it('Button mounts an empty live region while loading and explains a slow write without inviting resubmission', () => {
    const { rerender } = render(<Button>Save invoice</Button>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<Button loading>Save invoice</Button>);
    const button = screen.getByRole('button', { name: 'Save invoice' });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass('sr-only');

    advance(SLOW_THRESHOLD_MS);
    expect(region).toHaveTextContent(SLOW_MESSAGE);
    expect(region).toHaveTextContent(/do not submit again/i);
    expect(region).not.toHaveClass('sr-only');
    expect(button).toBeDisabled();

    rerender(<Button>Save invoice</Button>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The same <button> node survives the loading toggle, so focus is not lost.
    expect(screen.getByRole('button', { name: 'Save invoice' })).toBe(button);
  });

  it('Button resets the timer when a new request starts', () => {
    const { rerender } = render(<Button loading>Send</Button>);
    advance(SLOW_THRESHOLD_MS - 1000);
    rerender(<Button>Send</Button>);
    rerender(<Button loading>Send</Button>);
    advance(SLOW_THRESHOLD_MS - 1000);
    expect(screen.queryByText(SLOW_MESSAGE)).not.toBeInTheDocument();
    advance(1000);
    expect(screen.getByText(SLOW_MESSAGE)).toBeInTheDocument();
  });

  it('QueryErrorState explains a slow retry politely, outside the alert', () => {
    render(<QueryErrorState error={{ status: 503 }} onRetry={() => {}} isRetrying />);
    advance(SLOW_THRESHOLD_MS);
    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveTextContent(SLOW_MESSAGE);
    expect(screen.getByRole('status')).toHaveTextContent(SLOW_MESSAGE);
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });

  it('page skeletons announce the slow state and stop reporting busy', () => {
    render(<TablePageSkeleton label="Loading clients" />);
    const status = screen.getByRole('status', { name: 'Loading clients' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    advance(SLOW_THRESHOLD_MS);
    expect(status).toHaveTextContent(SLOW_MESSAGE);
    expect(status).not.toHaveAttribute('aria-busy');
  });

  it('SlowNotice renders nothing while idle and supports custom guidance', () => {
    const { rerender, container } = render(<SlowNotice active={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SlowNotice active guidance="Large exports can take a minute." />);
    advance(SLOW_THRESHOLD_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Large exports can take a minute.');
  });

  it('keeps the retry button clickable before a retry starts', () => {
    const onRetry = vi.fn();
    render(<QueryErrorState error={{ status: 500 }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
