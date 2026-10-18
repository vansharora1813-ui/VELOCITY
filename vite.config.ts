import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vitePluginAiChat } from './src/server/vitePluginAiChat.ts';

export default defineConfig({
  plugins: [react(), vitePluginAiChat()],
  server: {
    port: 3000,
    open: false,
  },
});
