import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleChatApiRequest } from '../src/server/chatHandler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleChatApiRequest(req, res);
}
