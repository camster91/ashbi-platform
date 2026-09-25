/**
 * ErrorBoundary Component Tests
 *
 * Verifies that the ErrorBoundary catches React render errors
 * and unhandled promise rejections, displaying the fallback UI
 * with a retry button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

// Component that throws on render
function ThrowOnRender({ error }) {
  throw new Error(error || 'Test error');
}

// Component that works fine
function GoodComponent() {
  return <div data-testid="good">All good</div>;
}

describe('ErrorBoundary', () => {
  // Suppress console.error for expected error boundary messages
  const originalError = console.error;

  beforeEach(() => {
    console.error = vi.fn((...args) => {
      // Only suppress React error boundary messages
      const msg = args.join('');
      if (msg.includes('The above error occurred in the') || msg.includes('Uncaught Error')) {
        return;
      }
      originalError.call(console, ...args);
    });
  });

  afterEach(() => {
    console.error = originalError;
    vi.restoreAllMocks();
  });

  describe('normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <GoodComponent />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('good')).toBeInTheDocument();
      expect(screen.getByText('All good')).toBeInTheDocument();
    });

    it('does not show error UI when children render successfully', () => {
      render(
        <ErrorBoundary>
          <GoodComponent />
        </ErrorBoundary>
      );

      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reload application/i })).not.toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('catches render errors and shows fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender error="Something broke" />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.queryByTestId('good')).not.toBeInTheDocument();
    });

    it('shows a reference instead of the raw error message', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender error="Custom error message for jane@example.com" />
        </ErrorBoundary>
      );

      expect(screen.queryByText(/Custom error message/)).not.toBeInTheDocument();
      expect(screen.queryByText(/jane@example.com/)).not.toBeInTheDocument();
      expect(screen.getByTestId('error-reference')).toHaveTextContent(/^ERR-[0-9A-Z]+-[0-9A-F]{8}$/);
    });

    it('shows an explicit reload button in the fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      );

      expect(screen.getByRole('button', { name: /reload application/i })).toBeInTheDocument();
    });

    it('shows AlertTriangle icon in the error UI', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      );

      // lucide-react icons are rendered as SVGs
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('shows "The application encountered an unexpected error" for render errors', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      );

      expect(screen.getByText('The application encountered an unexpected error.')).toBeInTheDocument();
    });
  });

  describe('onError callback', () => {
    it('calls the onError prop when an error is caught', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowOnRender error="Reported error" />
        </ErrorBoundary>
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toBe('Reported error');
      // Second argument is errorInfo with componentStack
      expect(onError.mock.calls[0][1]).toHaveProperty('componentStack');
    });
  });

  describe('retry behavior', () => {
    it('reloads the page when "Reload application" is clicked', () => {
      const reloadMock = vi.fn();
      window.location.reload = reloadMock;

      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      );

      const retryButton = screen.getByRole('button', { name: /reload application/i });
      fireEvent.click(retryButton);

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  it('does not claim an error was logged when no reporting callback exists', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>
    );

    expect(screen.queryByText(/has been logged/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Reloading may discard unsaved changes/i)).toBeInTheDocument();
  });

  it('keeps the recovery control explicit, touch-sized, and visibly focused', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>
    );

    const button = screen.getByRole('button', { name: /reload application/i });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:outline-none', 'focus-visible:ring-2');
  });

  describe('unhandled promise rejection', () => {
    it('sets up and tears down unhandledrejection listener', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(
        <ErrorBoundary>
          <GoodComponent />
        </ErrorBoundary>
      );

      expect(addSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));

      unmount();

      expect(removeSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    });

    it('catches unhandled promise rejections', () => {
      render(
        <ErrorBoundary>
          <GoodComponent />
        </ErrorBoundary>
      );

      // Simulate an unhandled rejection event
      act(() => {
        const event = new Event('unhandledrejection');
        event.reason = new Error('Async error');
        event.preventDefault = vi.fn();
        window.dispatchEvent(event);
      });

      // The ErrorBoundary should show the error UI
      expect(screen.queryByText('Async error')).not.toBeInTheDocument();
      expect(screen.getByText('An unexpected error occurred while processing your request.')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('still renders the fatal screen when a non-Error value is thrown', () => {
      function ThrowNull() {
        throw {};
      }

      render(
        <ErrorBoundary>
          <ThrowNull />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByTestId('error-reference')).toHaveTextContent(/^ERR-/);
    });

    it('renders children with complex nesting', () => {
      render(
        <ErrorBoundary>
          <div>
            <span data-testid="nested">Nested content</span>
          </div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('nested')).toBeInTheDocument();
    });
  });
});
