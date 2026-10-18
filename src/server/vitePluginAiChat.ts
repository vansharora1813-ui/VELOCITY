import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { handleChatApiRequest } from './chatHandler.ts';
import { handleInvestigateApiRequest } from './investigateHandler.ts';
import { handleHealthApiRequest } from './healthHandler.ts';

export function vitePluginAiChat(env?: Record<string, string | undefined>): Plugin {
  const attachMiddleware = (server: ViteDevServer | PreviewServer) => {
    const activeEnv = { ...process.env, ...env };

    server.middlewares.use('/api/health', (req, res) => {
      handleHealthApiRequest(req, res, activeEnv).catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      });
    });

    server.middlewares.use('/api/chat', (req, res) => {
      handleChatApiRequest(req, res, activeEnv).catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      });
    });

    server.middlewares.use('/api/investigate', (req, res) => {
      handleInvestigateApiRequest(req, res, activeEnv).catch((err) => {
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
