import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bpms-vite-client-'));
const temporaryOutput = await fs.mkdtemp(path.join(os.tmpdir(), 'bpms-vite-dist-'));
const outputDirectory = path.join(projectDirectory, 'dist');

await fs.cp(path.join(projectDirectory, 'client'), temporaryRoot, { recursive: true });

try {
  await build({
    root: temporaryRoot,
    plugins: [react()],
    resolve: {
      alias: [
        { find: 'react/jsx-runtime', replacement: path.join(projectDirectory, 'node_modules/react/jsx-runtime.js') },
        { find: 'react-dom/client', replacement: path.join(projectDirectory, 'node_modules/react-dom/client.js') },
        { find: 'react-dom', replacement: path.join(projectDirectory, 'node_modules/react-dom/index.js') },
        { find: 'react', replacement: path.join(projectDirectory, 'node_modules/react/index.js') },
      ],
    },
    build: {
      outDir: temporaryOutput,
      emptyOutDir: true,
    },
  });
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.cp(temporaryOutput, outputDirectory, { recursive: true });
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  await fs.rm(temporaryOutput, { recursive: true, force: true });
}
