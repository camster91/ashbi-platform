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
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor-react';
          }
          // UI utilities
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/clsx') || id.includes('node_modules/tailwind-merge')) {
            return 'vendor-ui';
          }
          // Radix UI
          if (id.includes('node_modules/@radix-ui')) {
            return 'vendor-radix';
          }
          // TanStack Query
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-query';
          }
          // Date utilities
          if (id.includes('node_modules/date-fns') || id.includes('node_modules/framer-motion')) {
            return 'vendor-utils';
          }
          // Socket.io
          if (id.includes('node_modules/socket.io-client')) {
            return 'vendor-socket';
          }
        },
      },
    },
  },
});
