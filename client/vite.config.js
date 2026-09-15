import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The Express server (server/server.js) runs on port 5000 in local
      // dev (`npm run server` / `npm run dev`) — this forwards any /api/*
      // request from the Vite dev server straight to it.
      '/api': 'http://localhost:5000',
    },
  },
});
