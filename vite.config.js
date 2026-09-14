import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages: project-site base path (https://<user>.github.io/3d-galaga/)
  base: '/3d-galaga/',
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
