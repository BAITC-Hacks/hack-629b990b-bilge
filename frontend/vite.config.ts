import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В разработке фронтенд (5173) проксирует API и Socket.IO на сервер (3001).
const API = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // доступ из локальной сети (команда на одном Wi-Fi); API-сервер остаётся на 127.0.0.1 за прокси
    host: true,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
