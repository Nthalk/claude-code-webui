import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      // Only proxy backend auth routes, not /auth/callback (frontend route)
      '/auth/github': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/google': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/claude': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/me': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/logout': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/auth/providers': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3006',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
