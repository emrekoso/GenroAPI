import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.ts'],
    environmentMatchGlobs: [['packages/ui/**', 'jsdom']],
    setupFiles: ['packages/ui/src/setup.ts'],
  },
});
