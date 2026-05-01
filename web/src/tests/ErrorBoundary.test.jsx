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
      expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
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

    it('displays the error message in the fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender error="Custom error message" />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error message')).toBeInTheDocument();
    });

    it('shows a "Try Again" button in the fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      );

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
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
    it('reloads the page when "Try Again" is clicked', () => {
      const reloadMock = vi.fn();
      window.location.reload = reloadMock;

      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>
      );

      const retryButton = screen.getByRole('button', { name: /try again/i });
      fireEvent.click(retryButton);

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
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
      expect(screen.getByText('Async error')).toBeInTheDocument();
      expect(screen.getByText('An unexpected error occurred while processing your request.')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('shows "An unexpected error occurred" when error has no message', () => {
      function ThrowNull() {
        throw {};
      }

      render(
        <ErrorBoundary>
          <ThrowNull />
        </ErrorBoundary>
      );

      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
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