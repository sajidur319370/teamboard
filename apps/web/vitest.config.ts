import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'node', // unit tests of plain TS modules; no DOM needed yet
    include: ['src/**/*.test.ts'],
  },
});
