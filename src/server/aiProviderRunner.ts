import { getThinkingConfig } from './aiProvider.ts';
import {
  classifyGeminiError,
  classifyGroqError,
  classifyNetworkError,
} from './errorClassifier.ts';
import type { AiErrorInfo } from './types.ts';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function isValidModelIdentifier(model: string): boolean {
  return Boolean(model && /^[a-zA-Z0-9_./-]+$/.test(model));
}

export interface ProviderConfigs {
  gemini: {
    apiKey?: string;
    model: string;
    isConfigured: boolean;
    thinkingLevel: 'low' | 'high';
  };
  groq: {
    apiKey?: string;
    model: string;
    isConfigured: boolean;
  };
}

export function getProviderConfigs(
  env: Record<string, string | undefined> = process.env
): ProviderConfigs {
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_GENAI_API_KEY || env.AI_API_KEY;
  const geminiModel = (env.AI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const thinkingConfig = getThinkingConfig(env);

  const groqKey = env.GROQ_API_KEY;
  const groqModel = (env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim();

  return {
    gemini: {
      apiKey: geminiKey && geminiKey.trim().length > 0 ? geminiKey.trim() : undefined,
      model: geminiModel,
      isConfigured: Boolean(geminiKey && geminiKey.trim().length > 0),
      thinkingLevel: thinkingConfig.thinkingLevel,
    },
    groq: {
      apiKey: groqKey && groqKey.trim().length > 0 ? groqKey.trim() : undefined,
      model: groqModel,
      isConfigured: Boolean(groqKey && groqKey.trim().length > 0),
    },
  };
}

export interface AiProviderMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AiExecutionRequest {
  systemInstruction: string;
  messages: AiProviderMessage[];
  temperature: number;
  responseSchema?: unknown;
  feature: 'chat' | 'investigation';
  overallTimeoutMs?: number;
  perProviderTimeoutMs?: number;
}

export interface AiExecutionSuccess {
  success: true;
  rawText: string;
  providerUsed: 'gemini' | 'groq';
  upstreamMs: number;
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  thinkingLevel?: 'low' | 'high';
}

export interface AiExecutionFailure {
  success: false;
  code: 'CONFIG_REQUIRED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'INVALID_REQUEST';
  error: string;
  errorInfo: AiErrorInfo;
  upstreamMs: number;
}

export type AiExecutionOutcome = AiExecutionSuccess | AiExecutionFailure;

interface ProviderAttemptFailure {
  status?: number;
  errorInfo: AiErrorInfo;
  errorMsg: string;
}

export async function executeAiWithFallback(
  req: AiExecutionRequest,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch
): Promise<AiExecutionOutcome> {
  const startTime = Date.now();
  const configs = getProviderConfigs(env);

  // Validate model formats
  if (configs.gemini.isConfigured && !isValidModelIdentifier(configs.gemini.model)) {
    if (!configs.groq.isConfigured) {
      return {
        success: false,
        code: 'CONFIG_REQUIRED',
        error: `Invalid AI_MODEL configuration: "${configs.gemini.model}". Expected a valid model identifier like "gemini-3.8-flash".`,
        errorInfo: {
          kind: 'config_required',
          title: 'AI model configuration error',
          message: `Invalid AI_MODEL configuration: "${configs.gemini.model}". Expected a valid model identifier like "gemini-3.8-flash".`,
          retryable: false,
          proHint: false,
        },
        upstreamMs: 0,
      };
    }
  }

  if (configs.groq.isConfigured && !isValidModelIdentifier(configs.groq.model)) {
    if (!configs.gemini.isConfigured) {
      return {
        success: false,
        code: 'CONFIG_REQUIRED',
        error: `Invalid GROQ_MODEL configuration: "${configs.groq.model}". Expected a valid model identifier like "${DEFAULT_GROQ_MODEL}".`,
        errorInfo: {
          kind: 'config_required',
          title: 'AI model configuration error',
          message: `Invalid GROQ_MODEL configuration: "${configs.groq.model}". Expected a valid model identifier like "${DEFAULT_GROQ_MODEL}".`,
          retryable: false,
          proHint: false,
        },
        upstreamMs: 0,
      };
    }
  }

  // Neither configured
  if (!configs.gemini.isConfigured && !configs.groq.isConfigured) {
    const hint =
      req.feature === 'investigation'
        ? 'Add GEMINI_API_KEY to your environment variables or .env file to enable room investigation.'
        : 'Add GEMINI_API_KEY to your environment variables or .env file to activate Barkley and Cleo.';
    return {
      success: false,
      code: 'CONFIG_REQUIRED',
      error: `AI provider is not configured. ${hint}`,
      errorInfo: {
        kind: 'config_required',
        title: 'AI configuration required',
        message: `AI provider is not configured. ${hint}`,
        retryable: false,
        proHint: false,
      },
      upstreamMs: 0,
    };
  }

  const overallTimeoutMs = req.overallTimeoutMs ?? (req.feature === 'chat' ? 20000 : 25000);
  const perProviderTimeoutMs = req.perProviderTimeoutMs ?? (req.feature === 'chat' ? 10000 : 12000);
  const secrets = [configs.gemini.apiKey, configs.groq.apiKey].filter(Boolean) as string[];

  // Sequential order: Gemini first (if configured and valid), Groq second (if configured and valid)
  const providersToAttempt: Array<'gemini' | 'groq'> = [];
  if (configs.gemini.isConfigured && isValidModelIdentifier(configs.gemini.model)) {
    providersToAttempt.push('gemini');
  }
  if (configs.groq.isConfigured && isValidModelIdentifier(configs.groq.model)) {
    providersToAttempt.push('groq');
  }

  let geminiFailure: ProviderAttemptFailure | null = null;
  let groqFailure: ProviderAttemptFailure | null = null;
  let totalUpstreamMs = 0;

  for (let i = 0; i < providersToAttempt.length; i++) {
    const provider = providersToAttempt[i];
    const remainingBudget = overallTimeoutMs - (Date.now() - startTime);

    if (remainingBudget < 1000) {
      // Deadline expired before attempting next provider
      break;
    }

    const attemptTimeout = Math.min(perProviderTimeoutMs, remainingBudget);

    if (provider === 'gemini') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeout);
      const attemptStart = Date.now();

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${configs.gemini.model}:generateContent?key=${configs.gemini.apiKey}`;
        const payload = {
          systemInstruction: { parts: [{ text: req.systemInstruction }] },
          contents: req.messages.map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          })),
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: configs.gemini.thinkingLevel },
            ...(req.responseSchema ? { responseSchema: req.responseSchema } : {}),
          },
        };

        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const elapsed = Date.now() - attemptStart;
        totalUpstreamMs += elapsed;

        if (res.ok) {
          const data = await res.json();
          const candidate = data.candidates?.[0];
          const textPart = candidate?.content?.parts?.[0]?.text;

          if (textPart && textPart.trim().length > 0) {
            return {
              success: true,
              rawText: textPart,
              providerUsed: 'gemini',
              upstreamMs: totalUpstreamMs,
              promptTokens: data.usageMetadata?.promptTokenCount,
              candidatesTokens: data.usageMetadata?.candidatesTokenCount,
              totalTokens: data.usageMetadata?.totalTokenCount,
              thinkingLevel: configs.gemini.thinkingLevel,
              finishReason: candidate?.finishReason,
            };
          }

          // Empty response from Gemini
          geminiFailure = {
            status: res.status,
            errorInfo: {
              kind: 'unknown',
              title: 'Empty AI response',
              message: 'AI model returned an empty response.',
              retryable: false,
            },
            errorMsg: 'AI model returned an empty response.',
          };
        } else {
          let errorData: unknown;
          try {
            errorData = await res.json();
          } catch {
            // fallback
          }

          const errorInfo = classifyGeminiError(
            res.status,
            res.statusText,
            errorData,
            res.headers,
            secrets
          );

          let errorMsg = errorInfo.detailSafe || `AI provider error: ${errorInfo.message}`;
          if (res.status === 429) {
            errorMsg = `AI provider rate limit reached. ${errorInfo.title}: ${errorInfo.message}`;
          } else if (res.status === 404) {
            errorMsg = `AI model "${configs.gemini.model}" is not found or unsupported by the provider: ${errorInfo.detailSafe || errorInfo.message}`;
          } else if (res.status === 400 || res.status === 413) {
            errorMsg = errorInfo.detailSafe || `AI provider rejected request (HTTP ${res.status})`;
          }

          geminiFailure = { status: res.status, errorInfo, errorMsg };
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - attemptStart;
        totalUpstreamMs += elapsed;
        const networkInfo = classifyNetworkError(fetchErr, secrets);
        geminiFailure = {
          errorInfo: networkInfo,
          errorMsg:
            networkInfo.kind === 'timeout'
              ? `AI provider request timed out (${Math.round(attemptTimeout / 1000)}s limit). Please try again.`
              : `Failed to communicate with AI provider: ${networkInfo.detailSafe || 'Network failure'}`,
        };
      }
    } else if (provider === 'groq') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeout);
      const attemptStart = Date.now();

      try {
        const groqMessages = [
          { role: 'system', content: req.systemInstruction },
          ...req.messages.map((m) => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text,
          })),
        ];

        const payload = {
          model: configs.groq.model,
          messages: groqMessages,
          temperature: req.temperature,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        };

        const res = await fetchFn(GROQ_API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${configs.groq.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const elapsed = Date.now() - attemptStart;
        totalUpstreamMs += elapsed;

        if (res.ok) {
          const data = await res.json();
          const choice = data.choices?.[0];
          const textPart = choice?.message?.content;

          if (textPart && textPart.trim().length > 0) {
            return {
              success: true,
              rawText: textPart,
              providerUsed: 'groq',
              upstreamMs: totalUpstreamMs,
              promptTokens: data.usage?.prompt_tokens,
              candidatesTokens: data.usage?.completion_tokens,
              totalTokens: data.usage?.total_tokens,
              finishReason: choice?.finish_reason,
            };
          }

          groqFailure = {
            status: res.status,
            errorInfo: {
              kind: 'unknown',
              title: 'Empty AI response',
              message: 'Fallback AI model returned an empty response.',
              retryable: false,
            },
            errorMsg: 'Fallback AI model returned an empty response.',
          };
        } else {
          let errorData: unknown;
          try {
            errorData = await res.json();
          } catch {
            // fallback
          }

          const errorInfo = classifyGroqError(
            res.status,
            res.statusText,
            errorData,
            res.headers,
            secrets
          );

          let errorMsg = errorInfo.detailSafe || `Fallback AI provider error: ${errorInfo.message}`;
          if (res.status === 429) {
            errorMsg = `Fallback AI provider rate limit reached. ${errorInfo.title}: ${errorInfo.message}`;
          } else if (res.status === 404) {
            errorMsg = `Fallback AI model "${configs.groq.model}" is not found or unsupported by the provider: ${errorInfo.detailSafe || errorInfo.message}`;
          }

          groqFailure = { status: res.status, errorInfo, errorMsg };
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - attemptStart;
        totalUpstreamMs += elapsed;
        const networkInfo = classifyNetworkError(fetchErr, secrets);
        groqFailure = {
          errorInfo: networkInfo,
          errorMsg:
            networkInfo.kind === 'timeout'
              ? `Fallback AI provider request timed out (${Math.round(attemptTimeout / 1000)}s limit).`
              : `Failed to communicate with fallback AI provider: ${networkInfo.detailSafe || 'Network failure'}`,
        };
      }
    }
  }

  // All attempted providers failed
  if (geminiFailure && groqFailure) {
    const isBothRateLimited =
      geminiFailure.errorInfo.kind === 'rate_limit_short' ||
      geminiFailure.errorInfo.kind === 'quota_exceeded_daily' ||
      groqFailure.errorInfo.kind === 'rate_limit_short' ||
      groqFailure.errorInfo.kind === 'quota_exceeded_daily';

    const code = isBothRateLimited ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
    const combinedError = `All configured AI providers (Gemini primary and Groq fallback) failed. Primary: ${geminiFailure.errorMsg} Fallback: ${groqFailure.errorMsg}`;

    const errorInfo: AiErrorInfo = {
      kind: groqFailure.errorInfo.kind !== 'unknown' ? groqFailure.errorInfo.kind : geminiFailure.errorInfo.kind,
      title: isBothRateLimited ? 'AI providers currently rate-limited' : 'AI providers unavailable',
      message: isBothRateLimited
        ? 'Both primary (Gemini) and fallback (Groq) providers have reached their rate limits. Your saved architecture and evidence are safe.'
        : 'All configured AI providers failed to process your request. Your saved project and evidence remain safe.',
      retryable: true,
      detailSafe: combinedError,
      proHint: isBothRateLimited,
    };

    return {
      success: false,
      code,
      error: combinedError,
      errorInfo,
      upstreamMs: totalUpstreamMs,
    };
  }

  if (geminiFailure) {
    const code =
      geminiFailure.status === 429
        ? 'RATE_LIMITED'
        : geminiFailure.status === 404
        ? 'PROVIDER_ERROR'
        : geminiFailure.errorInfo.kind === 'config_required'
        ? 'CONFIG_REQUIRED'
        : geminiFailure.status === 400 || geminiFailure.status === 413
        ? 'INVALID_REQUEST'
        : 'PROVIDER_ERROR';

    return {
      success: false,
      code,
      error: geminiFailure.errorMsg,
      errorInfo: geminiFailure.errorInfo,
      upstreamMs: totalUpstreamMs,
    };
  }

  if (groqFailure) {
    const code =
      groqFailure.status === 429
        ? 'RATE_LIMITED'
        : groqFailure.status === 404
        ? 'PROVIDER_ERROR'
        : groqFailure.errorInfo.kind === 'config_required'
        ? 'CONFIG_REQUIRED'
        : groqFailure.status === 400 || groqFailure.status === 413
        ? 'INVALID_REQUEST'
        : 'PROVIDER_ERROR';

    return {
      success: false,
      code,
      error: groqFailure.errorMsg,
      errorInfo: groqFailure.errorInfo,
      upstreamMs: totalUpstreamMs,
    };
  }

  // Fallback if loop didn't run (e.g. deadline expired)
  return {
    success: false,
    code: 'PROVIDER_ERROR',
    error: 'AI request timed out before provider could respond.',
    errorInfo: {
      kind: 'timeout',
      title: 'AI request timed out',
      message: 'The AI request timed out before provider could respond.',
      retryable: true,
    },
    upstreamMs: totalUpstreamMs,
  };
}
