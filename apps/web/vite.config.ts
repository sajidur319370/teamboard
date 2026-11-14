import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // Pre-bundle these BEFORE the first page is served. Without it, a cold start (fresh
  // clone, CI) served some packages raw (e.g. radix-ui's tooltip) next to the pre-bundled
  // React: two Reacts, an 'Invalid hook call' and a blank page until a manual reload.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'react-router',
      'radix-ui',
      '@tanstack/react-query',
      '@tanstack/react-query-devtools',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'socket.io-client',
      'sonner',
      'next-themes',
      'lucide-react',
      'react-markdown',
      'react-hook-form',
      '@hookform/resolvers/zod',
      'zustand',
      'zustand/middleware',
      'zod',
      'recharts',
      'fractional-indexing',
      'class-variance-authority',
      'cn',
    ],
  },
  server: {
    // The browser only ever talks to :5173, so dev is "same origin" just like production.
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
