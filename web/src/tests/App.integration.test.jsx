/**
 * App Routing + ErrorBoundary Integration Tests
 *
 * Tests the top-level App component to verify:
 * - ErrorBoundary catches errors in lazy-loaded routes
 * - Error boundary isolation between sections
 * - Nested ErrorBoundary behavior
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';

describe('ErrorBoundary Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with working components', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div data-testid="child">Hello World</div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('renders multiple children within nested structure', () => {
      render(
        <ErrorBoundary>
          <div>
            <header data-testid="header">Header</header>
            <main data-testid="main">Content</main>
          </div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('main')).toBeInTheDocument();
    });
  });

  describe('with throwing components', () => {
    // Suppress React error boundary console noise
    const originalError = console.error;
    beforeEach(() => {
      console.error = vi.fn((...args) => {
        const msg = args.join('');
        if (msg.includes('The above error occurred in') || msg.includes('Uncaught Error')) {
          return;
        }
        originalError.call(console, ...args);
      });
    });

    afterEach(() => {
      console.error = originalError;
    });

    it('catches errors and shows error boundary UI', () => {
      function BrokenComponent() {
        throw new Error('Component crashed!');
      }

      render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Component crashed!')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('shows "Try Again" button in error state', () => {
      function BrokenComponent() {
        throw new Error('Oops');
      }

      render(
        <ErrorBoundary>
          <BrokenComponent />
        </ErrorBoundary>
      );

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('isolates errors to the ErrorBoundary scope', () => {
      function BrokenComponent() {
        throw new Error('Isolated error');
      }

      render(
        <div>
          <div data-testid="sibling">I am fine</div>
          <ErrorBoundary>
            <BrokenComponent />
          </ErrorBoundary>
        </div>
      );

      // Sibling elements outside the error boundary should still render
      expect(screen.getByTestId('sibling')).toBeInTheDocument();
      // Error boundary should show its fallback
      expect(screen.getByText('Isolated error')).toBeInTheDocument();
    });
  });

  describe('nested ErrorBoundary (app-level pattern)', () => {
    it('inner boundary catches errors without affecting outer', () => {
      const outerOnError = vi.fn();
      const innerOnError = vi.fn();

      function BrokenComponent() {
        throw new Error('Child error');
      }

      render(
        <ErrorBoundary onError={outerOnError}>
          <div data-testid="outer-content">
            <h1>App Shell</h1>
            <ErrorBoundary onError={innerOnError}>
              <BrokenComponent />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>
      );

      // Inner boundary should catch the error
      expect(innerOnError).toHaveBeenCalledTimes(1);
      expect(innerOnError.mock.calls[0][0].message).toBe('Child error');

      // Outer boundary should NOT catch because inner caught it
      expect(outerOnError).not.toHaveBeenCalled();

      // Outer content should still be visible (inner shows error fallback)
      expect(screen.getByText('App Shell')).toBeInTheDocument();
    });
  });

  describe('ErrorBoundary with Suspense pattern', () => {
    it('wraps Suspense without interfering with successful loads', () => {
      function LoadedComponent() {
        return <div data-testid="loaded">Loaded successfully</div>;
      }

      render(
        <ErrorBoundary>
          <React.Suspense fallback={<div>Loading...</div>}>
            <LoadedComponent />
          </React.Suspense>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('loaded')).toBeInTheDocument();
    });
  });

  describe('route-level ErrorBoundary pattern', () => {
    it('simulates the App.jsx pattern: inner ErrorBoundary catches lazy route error', () => {
      const appOnError = vi.fn();
      const routeOnError = vi.fn();

      function BrokenPageRoute() {
        throw new Error('ChunkLoadError: Failed to fetch dynamic import');
      }

      render(
        <ErrorBoundary onError={appOnError}>
          <div data-testid="app-shell">
            <nav>Navigation</nav>
            <main>
              <ErrorBoundary onError={routeOnError}>
                <React.Suspense fallback={<div data-testid="loading">Loading...</div>}>
                  <BrokenPageRoute />
                </React.Suspense>
              </ErrorBoundary>
            </main>
          </div>
        </ErrorBoundary>
      );

      // Route-level boundary catches the error
      expect(routeOnError).toHaveBeenCalledTimes(1);

      // App-level boundary is NOT triggered
      expect(appOnError).not.toHaveBeenCalled();

      // App shell (nav etc.) is still visible
      expect(screen.getByText('Navigation')).toBeInTheDocument();

      // Error fallback is shown instead of the broken page
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });
});