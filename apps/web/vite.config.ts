import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = process.env.VITE_DEV_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(here, 'src') } },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  server: {
    // `vite` on :3000 with hot reload, game server from `wrangler dev` on :8787.
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/ws': { target: api, changeOrigin: true, ws: true },
    },
  },
});
