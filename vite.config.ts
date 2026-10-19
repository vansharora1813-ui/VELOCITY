import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { vitePluginAiChat } from './src/server/vitePluginAiChat.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  if (env.AI_MODEL) process.env.AI_MODEL = env.AI_MODEL;
  if (env.GROQ_API_KEY) process.env.GROQ_API_KEY = env.GROQ_API_KEY;
  if (env.GROQ_MODEL) process.env.GROQ_MODEL = env.GROQ_MODEL;

  return {
    plugins: [react(), vitePluginAiChat(env)],
    server: {
      port: 3000,
      open: false,
    },
  };
});

