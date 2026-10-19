import { buildSystemPrompt } from './contextBuilder.ts';
import type {
  ChatApiRequest,
  ChatApiResponse,
  CompanionReplyMessage,
} from './types.ts';

export function parseAndValidateReplies(rawJsonText: string): CompanionReplyMessage[] {
  let cleaned = rawJsonText.trim();
  // Strip Markdown code fencing if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Malformed JSON received from AI model.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Model output must be a JSON array of messages.');
  }

  if (parsed.length === 0) {
    throw new Error('Model output must contain at least one message.');
  }

  const validSpeakers = new Set(['dog', 'cat']);
  const validatedReplies: CompanionReplyMessage[] = [];

  for (const item of parsed.slice(0, 2)) {
    if (!item || typeof item !== 'object') {
      throw new Error('Message entry must be an object.');
    }

    const { speaker, text, evidenceReference } = item as Record<string, unknown>;

    if (typeof speaker !== 'string' || !validSpeakers.has(speaker.toLowerCase())) {
      throw new Error(`Invalid speaker ID: "${speaker}". Expected "dog" or "cat".`);
    }

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Message text cannot be empty.');
    }

    validatedReplies.push({
      speaker: speaker.toLowerCase() as 'dog' | 'cat',
      text: text.trim().slice(0, 600), // Bounded length
      evidenceReference:
        typeof evidenceReference === 'string' && evidenceReference.trim().length > 0
          ? evidenceReference.trim().slice(0, 150)
          : undefined,
    });
  }

  return validatedReplies;
}

export async function executeAiChat(
  request: ChatApiRequest,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch
): Promise<ChatApiResponse> {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_GENAI_API_KEY || env.AI_API_KEY;
  const rawModel = (env.AI_MODEL || 'gemini-3.8-flash').trim();

  if (!rawModel || !/^[a-zA-Z0-9_.-]+$/.test(rawModel)) {
    return {
      success: false,
      code: 'CONFIG_REQUIRED',
      error: `Invalid AI_MODEL configuration: "${rawModel}". Expected a valid model identifier like "gemini-3.8-flash".`,
    };
  }
  const model = rawModel;

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      success: false,
      code: 'CONFIG_REQUIRED',
      error: 'AI provider is not configured. Add GEMINI_API_KEY to your environment variables or .env file to activate Barkley and Cleo.',
    };
  }

  // Validate user message length
  const userMessage = (request.message || '').trim();
  if (userMessage.length === 0) {
    return {
      success: false,
      code: 'INVALID_REQUEST',
      error: 'User message cannot be empty.',
    };
  }
  if (userMessage.length > 2000) {
    return {
      success: false,
      code: 'INVALID_REQUEST',
      error: 'Message exceeds the maximum limit of 2,000 characters.',
    };
  }

  const systemInstruction = buildSystemPrompt(request);

  // Format conversation history for Gemini (last 4 turns max)
  const conversationContents: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [];

  // Add bounded history
  if (Array.isArray(request.history)) {
    const recentHistory = request.history.slice(-4);
    for (const h of recentHistory) {
      if (h.role === 'user') {
        conversationContents.push({ role: 'user', parts: [{ text: h.text }] });
      } else {
        conversationContents.push({ role: 'model', parts: [{ text: h.text }] });
      }
    }
  }

  // Add current turn
  conversationContents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: conversationContents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            speaker: { type: 'STRING', enum: ['dog', 'cat'] },
            text: { type: 'STRING' },
            evidenceReference: { type: 'STRING' },
          },
          required: ['speaker', 'text'],
        },
      },
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 429) {
      return {
        success: false,
        code: 'RATE_LIMITED',
        error: 'AI provider rate limit reached. Please wait a moment before sending another message.',
      };
    }

    if (!res.ok) {
      let detailMsg = res.statusText || `HTTP ${res.status}`;
      try {
        const errorData = await res.json();
        if (errorData?.error?.message) {
          // Redact any accidental key query param
          detailMsg = errorData.error.message.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
        }
      } catch {
        // use statusText fallback
      }

      if (res.status === 400 || res.status === 413) {
        return {
          success: false,
          code: 'INVALID_REQUEST',
          error: `AI provider rejected request (HTTP ${res.status}): ${detailMsg}`,
        };
      }

      if (res.status === 404) {
        return {
          success: false,
          code: 'PROVIDER_ERROR',
          error: `AI model "${model}" is not found or unsupported by the provider: ${detailMsg}`,
        };
      }

      return {
        success: false,
        code: 'PROVIDER_ERROR',
        error: `AI provider error (HTTP ${res.status}): ${detailMsg}`,
      };
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      return {
        success: false,
        code: 'PROVIDER_ERROR',
        error: 'AI model returned an empty response.',
      };
    }

    try {
      const replies = parseAndValidateReplies(textPart);
      return {
        success: true,
        replies,
      };
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Invalid response format';
      // Graceful fallback for plain-text model responses without inventing dialogue
      return {
        success: true,
        replies: [
          {
            speaker: 'dog',
            text: textPart.slice(0, 300),
          },
        ],
        error: `Warning: ${msg}`,
      };
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        code: 'PROVIDER_ERROR',
        error: 'AI provider request timed out (12s limit). Please try again.',
      };
    }
    let msg = err instanceof Error ? err.message : 'Network error';
    if (apiKey) {
      msg = msg.split(apiKey).join('[REDACTED]');
    }
    msg = msg.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
    return {
      success: false,
      code: 'PROVIDER_ERROR',
      error: `Failed to communicate with AI provider: ${msg}`,
    };
  }
}
