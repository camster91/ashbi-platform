import { defineConfig, searchForWorkspaceRoot } from 'vite';
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

// Deliver the unchanged entry stylesheet with the HTML to avoid a separate
// render-blocking request. Production already permits inline styles; keep the
// emitted asset and manifest intact for cache consumers and dynamic imports.
export function inlineEntryCssPlugin() {
  let base = '/';
  return {
    name: 'ashbi-inline-entry-css',
    apply: 'build',
    configResolved(config) { base = config.base || '/'; },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const assets = new Map(Object.values(ctx.bundle ?? {})
          .filter((item) => item.type === 'asset' && /^[\w./-]+\.css$/.test(item.fileName))
          .map((item) => [`${base.endsWith('/') ? base : `${base}/`}${item.fileName}`, item]));
        return html.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i, (_head, start, content, end) => {
          const inlined = content.replace(/<link\b[^>]*>/gi, (tag) => {
            // Preserve semantics of media, alternate, disabled, integrity, etc.
            // Only Vite's ordinary unconditional stylesheet link is eligible.
            const attributes = [...tag.matchAll(/\s([:\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)]
              .map((match) => match[1].toLowerCase());
            if (attributes.some((name) => !['rel', 'crossorigin', 'href'].includes(name))) return tag;
            if (new Set(attributes).size !== attributes.length) return tag;
            if (!/\brel=["']stylesheet["']/i.test(tag)) return tag;
            const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
            const asset = assets.get(href);
            if (!asset) return tag;
            const css = typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source);
            if (/<\/style/i.test(css)) throw new Error('Entry CSS contains an unsafe HTML style terminator');
            return `<style data-entry-css="${asset.fileName}">${css}</style>`;
          });
          return `${start}${inlined}${end}`;
        });
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
  { name: 'vendor-react', test: nodeModule(['react', 'scheduler']), priority: 30 },
  { name: 'vendor-react-dom', test: nodeModule(['react-dom']), priority: 29 },
  { name: 'vendor-router', test: nodeModule(['react-router', 'react-router-dom']), priority: 25 },
  { name: 'vendor-query', test: nodeModule(['@tanstack']), priority: 20 },
  { name: 'vendor-utils', test: nodeModule(['date-fns', 'framer-motion']), priority: 20 },
  { name: 'vendor-socket', test: nodeModule(['socket.io-client', 'engine.io-client', 'socket.io-parser', 'engine.io-parser', '@socket.io']), priority: 20 },
  // Keep entry/Login icons together with class helpers without pulling every
  // workspace icon onto the sign-in path. A single chunk also avoids adding
  // mobile network round trips for each tiny icon module. Keep this selection
  // aligned with entry/Login static imports, using Lucide canonical filenames
  // when public icons or dependency aliases change.
  {
    name: 'vendor-ui',
    // Tailwind's merge registry is used only by workspace components; do not
    // pull it into sign-in through the lightweight clsx helper.
    test: (id) => nodeModule(['clsx']).test(id)
      || /[\\/]node_modules[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/](arrow-down|arrow-right|arrow-right-left|arrow-up|ban|check-circle|circle-check|circle|circle-dot|clock|copy|eye|eye-off|file-text|globe|hammer|hourglass|info|loader-circle|lock|mail|message-square|message-square-warning|minus|pause|circle-pause|pen-line|play|refresh-cw|rocket|rotate-ccw|send|shield-check|sparkles|triangle-alert|users|x|circle-x|zap)\.m?js$/.test(id),
    priority: 10,
  },
];

export default defineConfig({
  plugins: [react(), routeChunkPreloadPlugin(), inlineEntryCssPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Dependency-free modules shared with the API (e.g. task priorities).
      '@shared': path.resolve(import.meta.dirname, '../src/shared'),
    },
  },
  server: {
    port: 5173,
    fs: {
      // Keep Vite's default (workspace root) and add the shared API modules.
      allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(import.meta.dirname, '../src/shared')],
    },
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
  worker: {
    format: 'es',
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
