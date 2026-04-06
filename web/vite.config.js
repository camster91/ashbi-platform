import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
