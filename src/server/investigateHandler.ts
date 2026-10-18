import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeRoomInvestigation } from './investigationProvider.ts';
import type { InvestigateApiRequest } from '../domain/investigation/types.ts';

export async function handleInvestigateApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }));
    return;
  }

  let bodyText = '';
  const maxBodyBytes = 150 * 1024; // 150 KB limit

  for await (const chunk of req) {
    bodyText += chunk;
    if (bodyText.length > maxBodyBytes) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: 'Payload Too Large' }));
      return;
    }
  }

  let requestData: InvestigateApiRequest;
  try {
    requestData = JSON.parse(bodyText || '{}');
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Malformed JSON payload' }));
    return;
  }

  if (!requestData.roomId || !requestData.repoContext) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        error: 'Missing required investigation parameters (roomId, repoContext).',
      })
    );
    return;
  }

  const result = await executeRoomInvestigation(requestData, env, fetchFn);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result));
}
