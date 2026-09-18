import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8790', '/docs': 'http://127.0.0.1:8790' } },
  build: { outDir: 'dist' },
});
