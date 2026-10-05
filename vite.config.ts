import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Development only: the janus example reaches the Janus REST API and rosbridge through the
  // dev server.
  server: {
    proxy: {
      '/janus': process.env.JANUS_URL ?? 'http://localhost:8088',
      '/rosbridge': { target: process.env.ROSBRIDGE_URL ?? 'ws://localhost:9090', ws: true, rewrite: () => '/' },
    },
  },
  build: {
    lib: {
      // The optional UI is a separate entry, so applications without it never load it.
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        ui: fileURLToPath(new URL('./src/ui/index.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
  },
  plugins: [{
    // No module imports the optional stylesheet, so the JS stays free of side effects.
    name: 'r3v-ui-css',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'ui.css', source: readFileSync(new URL('./src/ui/ui.css', import.meta.url)) });
    },
  }],
});
