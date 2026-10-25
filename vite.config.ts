/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    // Two pages: the public site and the organiser console (/admin).
    rolldownOptions: { input: { main: 'index.html', admin: 'admin.html' } },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['tests/scripts/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          testTimeout: 90_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
