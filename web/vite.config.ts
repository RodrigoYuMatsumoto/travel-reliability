import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      ['/v1', '/auth', '/health', '/schema', '/rules', '/public'].map((path) => [
        path,
        'http://127.0.0.1:4310',
      ]),
    ),
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 5173 },
});
