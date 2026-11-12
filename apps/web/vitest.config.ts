import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'node', // plain TS modules, plus server-side rendering (renderToStaticMarkup)
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
