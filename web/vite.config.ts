import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = env.VITE_API_URL || 'http://localhost:4327';

  // HTTPS on a LAN IP is NOT optional for the mobile surface: navigator.geolocation
  // and getUserMedia both refuse a plain-http origin that isn't localhost. Without it
  // the citizen app cannot get a location and the responder app cannot open the camera
  // to scan an Emirates ID — and both fail SILENTLY, which is the most common way a
  // mobile demo dies. `npm run dev:lan` turns it on.
  const needsHttps = mode === 'lan';

  return {
    plugins: [react(), ...(needsHttps ? [basicSsl()] : [])],

    envPrefix: 'VITE_',

    resolve: {
      alias: {
        '@':        fileURLToPath(new URL('./src', import.meta.url)),
        '@lib':     fileURLToPath(new URL('./src/lib', import.meta.url)),
        '@shared':  fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@console': fileURLToPath(new URL('./src/console', import.meta.url)),
        '@app':     fileURLToPath(new URL('./src/app', import.meta.url)),
        '@theme':   fileURLToPath(new URL('./src/theme', import.meta.url)),
      },
    },

    server: {
      port: 3327,
      // Fail loudly rather than silently moving to 3328 — the port is part of the
      // deployment convention (docs/12 §1), not a suggestion.
      strictPort: true,
      // The dev proxy means the browser sees ONE origin, so cookies and CORS behave in
      // development exactly as they do behind nginx in production.
      proxy: {
        '/api':       { target: apiTarget, changeOrigin: true, secure: false },
        '/health':    { target: apiTarget, changeOrigin: true, secure: false },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true, secure: false },
        '/uploads':   { target: apiTarget, changeOrigin: true, secure: false },
      },
    },

    preview: { port: 3327, strictPort: true },

    build: {
      target: 'es2022',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 1200,   // deck.gl and three are large by nature
      rollupOptions: {
        output: {
          manualChunks: {
            // Split the heavy map and 3D stacks so the mobile surface, which needs
            // neither at first paint, is not held up by them.
            maplibre: ['maplibre-gl'],
            deck: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox',
                   '@deck.gl/aggregation-layers', '@deck.gl/geo-layers'],
            three: ['three'],
            react: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
