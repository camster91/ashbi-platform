import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The login screen is the first page most visitors see, and its route chunk is
// only discovered after the entry bundle executes. Preloading that chunk (and
// the chunks it imports) from index.html removes a network round trip from
// the login page's largest contentful paint without making the route eager.
// Emitted as <link rel="modulepreload"> tags, so no inline script is needed
// under the production Content-Security-Policy.
const PRELOADED_ROUTE_CHUNKS = ['src/pages/Login.jsx'];

export function routeChunkPreloadPlugin(modules = PRELOADED_ROUTE_CHUNKS) {
  let base = '/';
  return {
    name: 'ashbi-route-chunk-preload',
    apply: 'build',
    configResolved(config) {
      base = config.base || '/';
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).filter((item) => item.type === 'chunk');
        const entry = chunks.find((chunk) => chunk.isEntry);
        const alreadyLoaded = new Set([entry?.fileName, ...(entry?.imports ?? [])]);
        const files = new Set();
        for (const moduleId of modules) {
          const chunk = chunks.find((item) => item.facadeModuleId?.replaceAll('\\', '/').endsWith(`/${moduleId}`));
          if (!chunk) throw new Error(`route preload: no chunk found for ${moduleId}`);
          for (const file of [chunk.fileName, ...chunk.imports]) {
            if (!alreadyLoaded.has(file)) files.add(file);
          }
        }
        return [...files].map((file) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `${base.endsWith('/') ? base : `${base}/`}${file}` },
          injectTo: 'head',
        }));
      },
    },
  };
}

const nodeModule = (names) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${names.join('|')})[\\\\/]`);

// Vendor chunk groups for Rolldown's code splitting. Groups pull their
// dependencies in with them, so the order of priorities matters: React is
// claimed first, otherwise the first group that imports it (TanStack Query)
// would absorb React core and drag that whole chunk onto every page's
// critical path, including the login screen that never uses a query client.
export const VENDOR_CHUNK_GROUPS = [
  { name: 'vendor-react', test: nodeModule(['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler']), priority: 30 },
  { name: 'vendor-query', test: nodeModule(['@tanstack']), priority: 20 },
  { name: 'vendor-radix', test: nodeModule(['@radix-ui']), priority: 20 },
  { name: 'vendor-utils', test: nodeModule(['date-fns', 'framer-motion']), priority: 20 },
  { name: 'vendor-socket', test: nodeModule(['socket.io-client', 'engine.io-client', 'socket.io-parser', 'engine.io-parser', '@socket.io']), priority: 20 },
  { name: 'vendor-ui', test: nodeModule(['lucide-react', 'clsx', 'tailwind-merge']), priority: 10 },
];

export default defineConfig({
  plugins: [react(), routeChunkPreloadPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    manifest: true,
    sourcemap: false, // disable in prod for smaller output
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: VENDOR_CHUNK_GROUPS,
        },
      },
    },
  },
});
