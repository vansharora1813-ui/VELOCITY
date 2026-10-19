import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { handleChatApiRequest } from './chatHandler.ts';
import { handleInvestigateApiRequest } from './investigateHandler.ts';
import { handleHealthApiRequest } from './healthHandler.ts';

import { loadEnv } from 'vite';

export function vitePluginAiChat(env?: Record<string, string | undefined>): Plugin {
  const attachMiddleware = (server: ViteDevServer | PreviewServer) => {
    const getActiveEnv = () => {
      const freshEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
      if (freshEnv.GEMINI_API_KEY) process.env.GEMINI_API_KEY = freshEnv.GEMINI_API_KEY;
      if (freshEnv.AI_MODEL) process.env.AI_MODEL = freshEnv.AI_MODEL;
      if (freshEnv.GROQ_API_KEY) process.env.GROQ_API_KEY = freshEnv.GROQ_API_KEY;
      if (freshEnv.GROQ_MODEL) process.env.GROQ_MODEL = freshEnv.GROQ_MODEL;
      return {
        ...env,
        ...process.env,
        ...freshEnv,
      };
    };

    server.middlewares.use('/api/health', (req, res) => {
      handleHealthApiRequest(req, res, getActiveEnv()).catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      });
    });

    server.middlewares.use('/api/chat', (req, res) => {
      handleChatApiRequest(req, res, getActiveEnv()).catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      });
    });

    server.middlewares.use('/api/investigate', (req, res) => {
      handleInvestigateApiRequest(req, res, getActiveEnv()).catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      });
    });
  };

  return {
    name: 'vite-plugin-ai-chat',
    configureServer(server: ViteDevServer) {
      attachMiddleware(server);
    },
    configurePreviewServer(server: PreviewServer) {
      attachMiddleware(server);
    },
  };
}
