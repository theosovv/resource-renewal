import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  const proxy = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
    },
  };

  return {
    plugins: [react()],
    envDir: workspaceRoot,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
  };
});
