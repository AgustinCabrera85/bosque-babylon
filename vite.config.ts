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
  server: { port: 5173, strictPort: true },
  // Scan the lazy level modules up front. Otherwise first opening the forest
  // can invalidate Babylon's pre-bundle during its dynamic import (HTTP 504).
  optimizeDeps: {
    entries: [
      'index.html',
      'src/game/levels/forest/createForestLevel.ts',
      'src/game/levels/theatre/createTheatreLevel.ts',
      'src/game/levels/sanctuary/createSanctuaryLevel.ts',
    ],
  },
  build: {
    sourcemap: false
  }
});
