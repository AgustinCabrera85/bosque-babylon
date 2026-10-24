import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

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
  // Keep level modules lazy. Babylon's native ESM stays outside Vite's shared
  // dependency bundle, so changing one scene cannot invalidate the classes
  // that another scene is currently constructing.
  optimizeDeps: {
    exclude: [
      '@babylonjs/core',
      '@babylonjs/inspector',
      '@babylonjs/loaders',
      '@babylonjs/materials',
    ],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        stormLab: fileURLToPath(new URL('./experiments/storm-fx-lab/index.html', import.meta.url)),
      },
    },
  }
});
