import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { setUnauthorizedCallback, setApiErrorCallback } from './lib/api';
import './index.css';

// OBSERVABILITY (audit 2026-07-09, swarm finding): the backend has had
// Sentry since commit 6884159, but the web side had zero Sentry wiring —
// every React render crash, every unhandledrejection, every broken route
// fell into a black hole. Wire the browser SDK here, gated on the
// VITE_SENTRY_DSN env so dev / preview builds stay quiet.
//
// Set VITE_SENTRY_DSN at build time (Coolify / .env) to enable. Without
// it, Sentry is a no-op (the SDK no-ops when DSN is missing).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // We don't need session replay for an internal admin tool.
    integrations: [Sentry.browserTracingIntegration()],
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

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
  setApiErrorCallback((error, endpoint) => {
    // Dispatch a custom event that the app can listen to for toast notifications
    window.dispatchEvent(new CustomEvent('api:error', {
      detail: { error, endpoint }
    }));
  });

  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ApiErrorHandler>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ApiErrorHandler>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
