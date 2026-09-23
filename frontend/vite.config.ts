import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend (5173) proxies the API and Socket.IO to the BFF in ../backend (3001 by default).
// The BFF client (../backend/client/index.ts) is imported directly, so access to the sibling folder is allowed.
const API = process.env.API_URL ?? 'http://127.0.0.1:3001';

// The dev proxy presents itself to the backend with the backend's own origin (always allowed):
// this way the dev server works on any port (5174…) and over the LAN without editing ALLOWED_ORIGINS.
const proxy = { target: API, headers: { origin: API } };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    fs: { allow: ['..'] },
    proxy: {
      '/api': proxy,
      '/socket.io': { ...proxy, ws: true },
    },
  },
});
