import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/battle-grabber/utils/**'],
      // 防回归下限：阈值略低于 2026-08-04 实测值（整体 stmts/lines 58.46%、branch 83.16%、
      // funcs 46.3%；src/lib/** stmts/lines 87.24%、branch 84.61%；
      // src/battle-grabber/utils/** stmts/lines 41.41%、branch 81.86%、funcs 34.82%），
      // 确保现状即可通过。
      thresholds: {
        'src/lib/**': {
          statements: 85,
          lines: 85,
          functions: 75,
          branches: 82,
        },
        'src/battle-grabber/utils/**': {
          statements: 35,
          lines: 35,
          functions: 30,
          branches: 75,
        },
        '**': {
          statements: 55,
          lines: 55,
          functions: 42,
          branches: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
