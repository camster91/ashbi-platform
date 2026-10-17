import '@testing-library/jest-dom';

// Mock window.matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},   // Deprecated
    removeListener: () => {}, // Deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Keep a complete URL for BrowserRouter while making reload replaceable in
// recovery tests. Newer React Router versions resolve navigation against it.
const locationFields = Object.fromEntries(
  ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']
    .map((field) => [field, window.location[field]]),
);
Object.defineProperty(window, 'location', {
  writable: true,
  value: { ...locationFields, reload: () => {} },
});
