import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { setUnauthorizedCallback, setApiErrorCallback } from './lib/api';
import './index.css';

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
