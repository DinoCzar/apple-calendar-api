import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Use 127.0.0.1 — on macOS, localhost resolves to ::1 but the API binds IPv4 only
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
