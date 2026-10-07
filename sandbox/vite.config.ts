// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  root: __dirname,
  base: command === 'build' ? '/bitbox-api-ts/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Point the sandbox at the library source so edits in ../src/ hot-reload
      // without needing a rebuild.
      '@bitboxswiss/bitbox-api': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
}));
