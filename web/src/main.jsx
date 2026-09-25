import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { setUnauthorizedCallback, setApiErrorCallback } from './lib/api';
import { applyTheme, getInitialTheme } from './lib/theme';
import { preloadInitialRoute } from './lib/initial-route';
import './index.css';

// Apply public/system preference before React renders the authentication
// gateway. Authenticated Layout replaces it with the account-scoped choice.
applyTheme(getInitialTheme());

// OBSERVABILITY (audit 2026-07-09, swarm finding): the backend has had
// Sentry since commit 6884159, but the web side had zero Sentry wiring —
// every React render crash, every unhandledrejection, every broken route
// fell into a black hole. Wire the browser SDK here, gated on the
// VITE_SENTRY_DSN env so dev / preview builds stay quiet.
//
// Set VITE_SENTRY_DSN at build time (Coolify / .env) to enable. The SDK is
// loaded with a dynamic import so it never sits on the first-paint critical
// path: builds without a DSN drop it entirely (it used to add ~21 KB of
// @sentry/core to the entry chunk even though it was never initialised), and
// builds with one fetch it alongside the first render instead of before it.
const sentry = import.meta.env.VITE_SENTRY_DSN
  ? import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
      // We don't need session replay for an internal admin tool.
      // Unhandled rejections are reported by ErrorBoundary's listener via
      // reportFatalError (tagged with the on-screen error reference), so turn
      // off the SDK's own rejection handler to avoid a duplicate, untagged event.
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: false }),
      ],
    });
    return Sentry;
  })
  : null;

function reportError(error) {
  sentry?.then((Sentry) => Sentry.captureException(error)).catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(reportError);
  });
}

// Component to set up global API error handling
function ApiErrorHandler({ children }) {
  // Set up the unauthorized callback to trigger logout
  setUnauthorizedCallback((message) => {
    // Dispatch a custom event that App.jsx can listen to
    window.dispatchEvent(new CustomEvent('api:unauthorized', {
      detail: { message }
    }));
  });

  // Set up the API error callback for global toast notifications
  setApiErrorCallback((error, endpoint, retry) => {
    // Dispatch a custom event that the app can listen to for toast notifications
    window.dispatchEvent(new CustomEvent('api:error', {
      detail: { error, endpoint, retry }
    }));
  });

  return children;
}

// Tag fatal errors with the reference shown on the fatal screen so support can
// find the matching event. No-op when Sentry is not configured.
function reportFatalError(error, errorInfo, errorType, reference) {
  sentry?.then((Sentry) => Sentry.captureException(error, {
    tags: { errorReference: reference, errorType },
    contexts: errorInfo?.componentStack ? { react: { componentStack: errorInfo.componentStack } } : undefined,
  })).catch(() => {});
}

preloadInitialRoute(window.location.pathname).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <ApiErrorHandler>
          <ErrorBoundary onError={reportFatalError}>
            <App />
          </ErrorBoundary>
        </ApiErrorHandler>
      </BrowserRouter>
    </React.StrictMode>
  );
});
