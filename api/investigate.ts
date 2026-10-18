import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleInvestigateApiRequest } from '../src/server/investigateHandler.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleInvestigateApiRequest(req, res);
}
