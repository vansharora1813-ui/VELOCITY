import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeAiChat } from './aiProvider.ts';
import type { ChatApiRequest } from './types.ts';

export async function handleChatApiRequest(
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
  const maxBodyBytes = 100 * 1024; // 100 KB limit

  for await (const chunk of req) {
    bodyText += chunk;
    if (bodyText.length > maxBodyBytes) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: 'Payload Too Large' }));
      return;
    }
  }

  let requestData: ChatApiRequest;
  try {
    requestData = JSON.parse(bodyText || '{}');
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Malformed JSON payload' }));
    return;
  }

  const result = await executeAiChat(requestData, env, fetchFn);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result));
}
