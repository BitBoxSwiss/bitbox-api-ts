// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      // Point the sandbox at the library source so edits in ../src/ hot-reload
      // without needing a rebuild.
      'bitbox-api-ts': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // `connectSimulator` is a Node-only path reached via dynamic import.
      // Tree-shaking drops it from the sandbox bundle, but Rollup still
      // analyses the target module and warns about `node:net`. Mark Node
      // builtins external so the analysis stays quiet.
      external: [/^node:/],
    },
  },
});
