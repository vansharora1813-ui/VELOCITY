import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { handleChatApiRequest } from './chatHandler.ts';
import { handleInvestigateApiRequest } from './investigateHandler.ts';
import { handleHealthApiRequest } from './healthHandler.ts';

export function vitePluginAiChat(): Plugin {
  const attachMiddleware = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api/health', (req, res, next) => {
      if (req.method === 'GET') {
        handleHealthApiRequest(req, res).catch((err) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        });
      } else {
        next();
      }
    });

    server.middlewares.use('/api/chat', (req, res, next) => {
      if (req.method === 'POST') {
        handleChatApiRequest(req, res).catch((err) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        });
      } else {
        next();
      }
    });

    server.middlewares.use('/api/investigate', (req, res, next) => {
      if (req.method === 'POST') {
        handleInvestigateApiRequest(req, res).catch((err) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        });
      } else {
        next();
      }
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
