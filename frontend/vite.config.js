import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendHost = process.env.BACKEND_HOST || 'localhost';
const backendPort = process.env.BACKEND_PORT || '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': `http://${backendHost}:${backendPort}`,
      '/lsp': {
        target: `ws://${backendHost}:${backendPort}`,
        ws: true
      }
    }
  }
});
