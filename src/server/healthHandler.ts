import type { IncomingMessage, ServerResponse } from 'node:http';

export async function handleHealthApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Method not allowed. Use GET.' }));
    return;
  }

  const hasApiKey = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
  const configuredModel = env.AI_MODEL || 'gemini-3.8-flash';

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'The Living Blueprint API',
      timestamp: new Date().toISOString(),
      aiConfigured: hasApiKey,
      model: configuredModel,
    })
  );
}
