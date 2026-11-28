import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const railwayAllowedHosts = [
  '*.up.railway.app',
  process.env.RAILWAY_PUBLIC_DOMAIN,
].filter((host): host is string => Boolean(host));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ['leaflet'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 3000,
    allowedHosts: railwayAllowedHosts,
  },
});
