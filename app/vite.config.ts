/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs so the build works under a GitHub Pages project path (/sys1-bench/).
  base: './',
  plugins: [react()],
  // The dataset lives one level up (../data), so let the dev server read it.
  server: { fs: { allow: ['..'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
