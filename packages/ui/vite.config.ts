import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.GENROAPI_PORT ?? 5174);
const target = `http://127.0.0.1:${port}`;

// The server only accepts Origin === http://<its own Host>, so rewrite it for dev.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        configure: proxy => proxy.on('proxyReq', req => { if (req.getHeader('origin')) req.setHeader('origin', target); }),
      },
    },
  },
});
