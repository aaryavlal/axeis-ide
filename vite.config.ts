import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages subpath.
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
});
