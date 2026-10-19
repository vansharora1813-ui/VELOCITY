import { buildSystemPrompt } from './contextBuilder.ts';
import { validateWorkflowDiagram } from '../domain/workflow/workflowValidator.ts';
import type {
  ChatApiRequest,
  ChatApiResponse,
  CompanionReplyMessage,
  WorkflowDiagram,
} from './types.ts';

export interface ValidatedChatResponse {
  replies: CompanionReplyMessage[];
  workflowDiagram?: WorkflowDiagram;
}

export function parseAndValidateChatResponse(
  rawJsonText: string,
  repoContext?: ChatApiRequest['repoContext']
): ValidatedChatResponse {
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

  let rawReplies: unknown;
  let rawWorkflowDiagram: unknown;

  if (Array.isArray(parsed)) {
    rawReplies = parsed;
    // Check if any item contains an embedded workflowDiagram
    for (const item of parsed) {
      if (item && typeof item === 'object' && 'workflowDiagram' in item) {
        rawWorkflowDiagram = (item as Record<string, unknown>).workflowDiagram;
        break;
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    rawReplies = obj.replies;
    rawWorkflowDiagram = obj.workflowDiagram;
  } else {
    throw new Error('Model output must be a JSON array of messages or an object containing replies.');
  }

  if (!Array.isArray(rawReplies)) {
    throw new Error('Model output must be a JSON array of messages.');
  }

  if (rawReplies.length === 0) {
    throw new Error('Model output must contain at least one message.');
  }

  const validSpeakers = new Set(['dog', 'cat']);
  const validatedReplies: CompanionReplyMessage[] = [];

  for (const item of rawReplies.slice(0, 2)) {
    if (!item || typeof item !== 'object') {
      throw new Error('Message entry must be an object.');
    }

    const { speaker, text, evidenceReference, workflowDiagram: itemDiagram } = item as Record<string, unknown>;

    if (typeof speaker !== 'string' || !validSpeakers.has(speaker.toLowerCase())) {
      throw new Error(`Invalid speaker ID: "${speaker}". Expected "dog" or "cat".`);
    }

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Message text cannot be empty.');
    }

    if (!rawWorkflowDiagram && itemDiagram) {
      rawWorkflowDiagram = itemDiagram;
    }

    validatedReplies.push({
      speaker: speaker.toLowerCase() as 'dog' | 'cat',
      text: text.trim().slice(0, 1500), // Bounded length allowing natural explanations
      evidenceReference:
        typeof evidenceReference === 'string' && evidenceReference.trim().length > 0
          ? evidenceReference.trim().slice(0, 150)
          : undefined,
    });
  }

  let validatedDiagram: WorkflowDiagram | undefined;
  if (rawWorkflowDiagram) {
    const sanitized = validateWorkflowDiagram(rawWorkflowDiagram, repoContext);
    if (sanitized) {
      validatedDiagram = sanitized;
      // Attach to primary speaking pet's message
      if (validatedReplies.length > 0) {
        validatedReplies[0].workflowDiagram = sanitized;
      }
    }
  }

  return {
    replies: validatedReplies,
    workflowDiagram: validatedDiagram,
  };
}

export function parseAndValidateReplies(
  rawJsonText: string,
  repoContext?: ChatApiRequest['repoContext']
): CompanionReplyMessage[] {
  const result = parseAndValidateChatResponse(rawJsonText, repoContext);
  return result.replies;
}

export function getThinkingConfig(
  env: Record<string, string | undefined> = process.env
): { thinkingLevel: 'low' | 'high' } {
  const envVal = (env.GEMINI_THINKING_LEVEL || env.AI_THINKING_LEVEL || 'low').trim().toLowerCase();
  if (envVal === 'high') {
    return { thinkingLevel: 'high' };
  }
  // Default is 'low' per T16 specification (reduces latency on Gemini 3.8 Flash)
  return { thinkingLevel: 'low' };
}

import { executeAiWithFallback } from './aiProviderRunner.ts';

export async function executeAiChat(
  request: ChatApiRequest,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch
): Promise<ChatApiResponse> {
  const startTime = Date.now();

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

  const contextPrepStart = Date.now();
  const systemInstruction = buildSystemPrompt(request);
  const contextPrepMs = Date.now() - contextPrepStart;

  // Format conversation history (last 4 turns max)
  const conversationContents: Array<{ role: 'user' | 'model'; text: string }> = [];

  if (Array.isArray(request.history)) {
    const recentHistory = request.history.slice(-4);
    for (const h of recentHistory) {
      conversationContents.push({
        role: h.role === 'user' ? 'user' : 'model',
        text: h.text,
      });
    }
  }

  // Add current turn
  conversationContents.push({
    role: 'user',
    text: userMessage,
  });

  const chatResponseSchema = {
    type: 'OBJECT',
    properties: {
      replies: {
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
      workflowDiagram: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          explanation: { type: 'STRING' },
          simulationType: { type: 'STRING' },
          nodes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                label: { type: 'STRING' },
                role: { type: 'STRING' },
                nodeType: { type: 'STRING', enum: ['component', 'decision', 'storage', 'external', 'step'] },
                roomId: { type: 'STRING' },
                filePath: { type: 'STRING' },
                classification: { type: 'STRING', enum: ['observed', 'inferred'] },
                description: { type: 'STRING' },
                inputs: { type: 'STRING' },
                outputs: { type: 'STRING' },
              },
              required: ['id', 'label', 'classification', 'description'],
            },
          },
          edges: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                from: { type: 'STRING' },
                to: { type: 'STRING' },
                label: { type: 'STRING' },
                branchLabel: { type: 'STRING' },
                classification: { type: 'STRING', enum: ['observed', 'inferred'] },
                evidenceReference: { type: 'STRING' },
              },
              required: ['from', 'to', 'classification'],
            },
          },
          uncertainties: { type: 'STRING' },
        },
        required: ['title', 'explanation', 'nodes', 'edges'],
      },
    },
    required: ['replies'],
  };

  const outcome = await executeAiWithFallback(
    {
      systemInstruction,
      messages: conversationContents,
      temperature: 0.7,
      responseSchema: chatResponseSchema,
      feature: 'chat',
      overallTimeoutMs: 20000,
      perProviderTimeoutMs: 10000,
    },
    env,
    fetchFn
  );

  if (!outcome.success) {
    return {
      success: false,
      code: outcome.code,
      error: outcome.error,
      errorInfo: outcome.errorInfo,
    };
  }

  const validationStart = Date.now();
  let replies: CompanionReplyMessage[];
  let workflowDiagram: WorkflowDiagram | undefined;
  let parseWarning: string | undefined;

  try {
    const validated = parseAndValidateChatResponse(outcome.rawText, request.repoContext);
    replies = validated.replies;
    workflowDiagram = validated.workflowDiagram;
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : 'Invalid response format';
    // Graceful fallback for plain-text model responses without inventing dialogue
    replies = [
      {
        speaker: 'dog',
        text: outcome.rawText.slice(0, 300),
      },
    ];
    parseWarning = `Warning: ${msg}`;
  }

  const validationMs = Date.now() - validationStart;
  const totalMs = Date.now() - startTime;

  const timing = {
    contextPrepMs,
    upstreamMs: outcome.upstreamMs,
    validationMs,
    totalMs,
    promptTokens: outcome.promptTokens,
    candidatesTokens: outcome.candidatesTokens,
    totalTokens: outcome.totalTokens,
    thinkingLevel: outcome.thinkingLevel,
    finishReason: outcome.finishReason,
    providerUsed: outcome.providerUsed,
    provider: outcome.providerUsed,
    fallbackUsed: outcome.providerUsed === 'groq',
  };

  return {
    success: true,
    replies,
    workflowDiagram,
    providerUsed: outcome.providerUsed,
    provider: outcome.providerUsed,
    fallbackUsed: outcome.providerUsed === 'groq',
    error: parseWarning,
    timing,
  };
}
