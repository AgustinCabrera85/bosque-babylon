import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'refresh-dev-source-modules',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        // A stale 304 can keep a broken browser copy of a transformed TS module.
        if (request.url?.startsWith('/src/')) {
          delete request.headers['if-none-match'];
        }
        next();
      });
    }
  }],
  server: { port: 5173, strictPort: false },
  build: {
    sourcemap: false
  }
});
