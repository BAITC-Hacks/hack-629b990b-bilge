import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Фронтенд (5173) проксирует API и Socket.IO на BFF из ../backend (по умолчанию 3001).
// Клиент BFF (../backend/client/index.ts) импортируется напрямую — поэтому разрешён доступ к соседней папке.
const API = process.env.API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: ['..'] },
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
