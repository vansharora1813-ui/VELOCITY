import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleHealthApiRequest } from '../src/server/healthHandler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleHealthApiRequest(req, res);
}
