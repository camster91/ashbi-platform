import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../components/ErrorBoundary';
import { SUPPORT_FALLBACK_TEXT, createErrorReference, getSupportContact } from '../lib/support';

function Boom() {
  throw new Error('Failed for client jane@example.com at /secret/path');
}

describe('support configuration', () => {
  it('reads VITE_SUPPORT_URL / VITE_SUPPORT_EMAIL and rejects unsafe values', () => {
    expect(getSupportContact({ VITE_SUPPORT_URL: 'https://help.example.test/desk', VITE_SUPPORT_EMAIL: ' help@example.test ' }))
      .toEqual({ url: 'https://help.example.test/desk', email: 'help@example.test', fallbackText: SUPPORT_FALLBACK_TEXT });
    expect(getSupportContact({ VITE_SUPPORT_URL: 'javascript:alert(1)', VITE_SUPPORT_EMAIL: 'not an email' }))
      .toEqual({ url: null, email: null, fallbackText: SUPPORT_FALLBACK_TEXT });
    expect(getSupportContact({})).toMatchObject({ url: null, email: null });
  });

  it('creates non-identifying, unique references', () => {
    const a = createErrorReference(0);
    const b = createErrorReference(0);
    expect(a).toMatch(/^ERR-0-[0-9A-F]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe('fatal error screen', () => {
  const originalError = console.error;
  beforeEach(() => { console.error = vi.fn(); });
  afterEach(() => { console.error = originalError; vi.restoreAllMocks(); });

  it('explains what happened, focuses the explanation, and hides raw error details', () => {
    render(<ErrorBoundary support={{ url: null, email: null, fallbackText: SUPPORT_FALLBACK_TEXT }}><Boom /></ErrorBoundary>);

    const heading = screen.getByRole('heading', { name: 'Something went wrong' });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/This view cannot continue/)).toBeInTheDocument();
    expect(screen.getByText(/Reloading may discard unsaved changes/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('jane@example.com');
    expect(document.body).not.toHaveTextContent('/secret/path');
    expect(document.body).not.toHaveTextContent(/at .*\.jsx/);
    // Fallback support guidance, no invented contact details.
    expect(screen.getByText(/contact your Ashbi Hub administrator/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links to configured support and passes the reference to onError', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError} support={{ url: 'https://help.example.test/', email: 'help@example.test', fallbackText: '' }}>
        <Boom />
      </ErrorBoundary>,
    );
    const reference = screen.getByTestId('error-reference').textContent;
    expect(reference).toMatch(/^ERR-/);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.anything(), 'React Error', reference);
    expect(screen.getByRole('link', { name: 'contact support' })).toHaveAttribute('href', 'https://help.example.test/');
    expect(screen.getByRole('link', { name: 'help@example.test' })).toHaveAttribute('href', 'mailto:help@example.test');
  });

  it('copies the reference and confirms only after the clipboard succeeds', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    const reference = screen.getByTestId('error-reference').textContent;
    const copy = screen.getByRole('button', { name: 'Copy reference' });

    await user.click(copy);
    expect(await screen.findByText(/Could not copy automatically/)).toBeInTheDocument();
    await user.click(copy);
    await waitFor(() => expect(screen.getByText('Reference copied.')).toBeInTheDocument());
    expect(writeText).toHaveBeenLastCalledWith(reference);
  });

  it('offers an in-place retry that re-renders children once the fault clears', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <p>Recovered view</p>;
    }
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered view')).toBeInTheDocument();
  });

  it('refocuses the explanation with a new reference when "Try again" hits a persistent error', async () => {
    const user = userEvent.setup();
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    const first = screen.getByTestId('error-reference').textContent;

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    const second = screen.getByTestId('error-reference').textContent;
    expect(second).toMatch(/^ERR-/);
    expect(second).not.toBe(first);
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toHaveFocus();
  });
});
