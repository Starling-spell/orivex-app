import { defineConfig, loadEnv } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ command, mode }) => {
  const appId = process.env.VITE_PRIVY_APP_ID ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_PRIVY_APP_ID;
  if (command === 'build' && !appId?.trim()) {
    throw new Error('Production build requires VITE_PRIVY_APP_ID. Pull the Vercel production environment before building.');
  }
  return {
  plugins: [nodePolyfills({ include: ['buffer', 'process', 'util'] })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022' },
  };
});
