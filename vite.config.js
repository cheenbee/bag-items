import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxy = env.VITE_API_PROXY || 'http://localhost:3001';

  return {
    plugins: [react()],
    root: 'client',
    server: {
      proxy: {
        '/api': apiProxy,
        '/uploads': apiProxy,
      },
    },
    build: { outDir: '../dist', emptyOutDir: true },
  };
});
