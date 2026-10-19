import { describe, it } from 'node:test';
import assert from 'node:assert';
import { executeAiChat } from '../src/server/aiProvider.ts';
import { executeRoomInvestigation } from '../src/server/investigationProvider.ts';
import {
  getProviderConfigs,
  DEFAULT_GROQ_MODEL,
  isValidModelIdentifier,
} from '../src/server/aiProviderRunner.ts';
import { redactSensitiveInfo } from '../src/server/errorClassifier.ts';
import type { ChatApiRequest } from '../src/server/types.ts';
import type { InvestigateApiRequest } from '../src/domain/investigation/types.ts';

describe('T21 — Groq Automatic AI Fallback & Recovery', () => {
  const baseChatRequest: ChatApiRequest = {
    message: 'Explain how task creation works and whether titles are validated.',
    repoContext: {
      owner: 'sakshamgupta005',
      repo: 'patchboard-tasks-api',
      branch: 'main',
      commitSha: '4ddfe585adbccd57794efba49ca1102ff654382f',
      totalFiles: 18,
      inspectedFiles: [
        {
          path: 'src/tasks/validation.js',
          category: 'source',
          contentExcerpt: 'function validateTaskTitle(title) { if (title.length === 0) return false; return true; }',
        },
        {
          path: 'test/createTask.test.js',
          category: 'test',
          contentExcerpt: 'it("rejects whitespace-only title", () => { ... });',
        },
      ],
      discoveredFilePaths: ['src/tasks/validation.js', 'test/createTask.test.js'],
      detectedTechnologies: ['JavaScript', 'Node.js', 'Express'],
      roomSummaries: [
        {
          id: 'room-validation',
          name: 'Input Validation & Schema',
          status: 'blocked',
          evidence: 'Test failure in test/createTask.test.js',
        },
      ],
    },
  };

  const baseInvestigateRequest: InvestigateApiRequest = {
    roomId: 'room-validation',
    roomName: 'Input Validation & Schema',
    roomLayer: 'domain',
    roomStatus: 'blocked',
    roomEvidence: 'Test failure in test/createTask.test.js',
    roomFilePaths: ['src/tasks/validation.js'],
    repoContext: {
      owner: 'sakshamgupta005',
      repo: 'patchboard-tasks-api',
      branch: 'main',
      commitSha: '4ddfe585adbccd57794efba49ca1102ff654382f',
      inspectedFiles: [
        {
          path: 'src/tasks/validation.js',
          category: 'source',
          contentExcerpt: 'function validateTaskTitle(title) { if (title.length === 0) return false; return true; }',
        },
        {
          path: 'test/createTask.test.js',
          category: 'test',
          contentExcerpt: 'it("rejects whitespace-only title", () => { ... });',
        },
      ],
      discoveredFilePaths: ['src/tasks/validation.js', 'test/createTask.test.js'],
      detectedTechnologies: ['JavaScript', 'Node.js'],
      ciEvaluation: {
        status: 'failing',
        isVerified: false,
        reason: 'CI check failed',
        checkRunsCount: 1,
        failedChecks: ['Run Unit and Integration Tests'],
      },
    },
  };

  // Scenario 1: Gemini success without contacting Groq
  it('1. Gemini success without contacting Groq', async () => {
    let geminiCalled = 0;
    let groqCalled = 0;

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('googleapis.com')) {
        geminiCalled++;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        replies: [
                          {
                            speaker: 'dog',
                            text: 'Barkley here! Validation handles title checks.',
                            evidenceReference: 'src/tasks/validation.js',
                          },
                        ],
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { totalTokenCount: 150 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('api.groq.com')) {
        groqCalled++;
        return new Response('{}', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await executeAiChat(
      baseChatRequest,
      {
        GEMINI_API_KEY: 'test-gemini-key',
        GROQ_API_KEY: 'test-groq-key',
      },
      mockFetch as unknown as typeof fetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.provider, 'gemini');
    assert.strictEqual(res.fallbackUsed, false);
    assert.strictEqual(geminiCalled, 1, 'Gemini should be called exactly once');
    assert.strictEqual(groqCalled, 0, 'Groq should NEVER be contacted when Gemini succeeds');
    assert.strictEqual(res.replies?.[0]?.speaker, 'dog');
  });

  // Scenario 2: Gemini daily quota exhaustion → Groq success
  it('2. Gemini daily quota exhaustion immediately attempts Groq without retrying Gemini', async () => {
    let geminiCalled = 0;
    let groqCalled = 0;

    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('googleapis.com')) {
        geminiCalled++;
        // 429 Daily Quota Exceeded
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per day' of service 'generativelanguage.googleapis.com'",
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('api.groq.com')) {
        groqCalled++;
        const parsedBody = JSON.parse(init?.body as string);
        assert.strictEqual(parsedBody.model, 'qwen/qwen3.8-27b');
        assert.strictEqual(parsedBody.response_format.type, 'json_object');
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    replies: [
                      {
                        speaker: 'dog',
                        text: 'Barkley here via Groq backup! The code verifies title length.',
                      },
                      {
                        speaker: 'cat',
                        text: 'Cleo noting: whitespace-only strings are not trimmed.',
                      },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { total_tokens: 180 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await executeAiChat(
      baseChatRequest,
      {
        GEMINI_API_KEY: 'gemini-secret-1234',
        GROQ_API_KEY: 'gsk_groq_secret_5678',
      },
      mockFetch as unknown as typeof fetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.provider, 'groq');
    assert.strictEqual(res.fallbackUsed, true);
    assert.strictEqual(res.timing?.provider, 'groq');
    assert.strictEqual(res.timing?.fallbackUsed, true);
    assert.strictEqual(geminiCalled, 1, 'Gemini daily quota exhaustion must NOT be retried');
    assert.strictEqual(groqCalled, 1, 'Groq must be attempted once');
    assert.strictEqual(res.replies?.length, 2);
  });

  // Scenario 3: Gemini timeout or server error → Groq success
  it('3. Gemini timeout or 503 service error falls back to Groq successfully', async () => {
    let geminiCalled = 0;
    let groqCalled = 0;

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('googleapis.com')) {
        geminiCalled++;
        // 503 Service Unavailable
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: 'The model is overloaded. Please try again later.',
              status: 'UNAVAILABLE',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('api.groq.com')) {
        groqCalled++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Title whitespace validation bypass',
                    explanation: 'The validateTaskTitle function checks raw length without trimming whitespace.',
                    category: 'possible_bug',
                    severity: 'medium',
                    evidenceClassification: 'observed',
                    evidencePaths: ['src/tasks/validation.js'],
                    codeEvidence: {
                      filePath: 'src/tasks/validation.js',
                      targetIdentifier: 'validateTaskTitle',
                      codeSnippet: 'if (title.length === 0) return false;',
                      explanation: 'Checks raw string length without trimming whitespace.',
                    },
                    recommendedNextStep: 'Trim title before checking length.',
                    uncertainties: 'None for validation unit.',
                    companionMessages: [
                      { speaker: 'dog', text: 'Barkley spotted the issue in validation.js!' },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await executeRoomInvestigation(
      baseInvestigateRequest,
      {
        GEMINI_API_KEY: 'test-gemini-key',
        GROQ_API_KEY: 'test-groq-key',
      },
      mockFetch as unknown as typeof fetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.provider, 'groq');
    assert.strictEqual(res.finding?.provider, 'groq');
    assert.strictEqual(res.finding?.fallbackUsed, true);
    assert.strictEqual(res.finding?.category, 'possible_bug');
    assert.strictEqual(res.finding?.evidenceClassification, 'observed');
    assert.strictEqual(res.finding?.codeEvidence?.targetIdentifier, 'validateTaskTitle');
    assert.strictEqual(geminiCalled, 1);
    assert.strictEqual(groqCalled, 1);
  });

  // Scenario 4: Gemini key/configuration failure → Groq success
  it('4. Gemini key/configuration failure immediately uses Groq fallback', async () => {
    let groqCalled = 0;

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.groq.com')) {
        groqCalled++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    replies: [{ speaker: 'dog', text: 'Groq answered directly!' }],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    // No GEMINI_API_KEY, but valid GROQ_API_KEY
    const res = await executeAiChat(
      baseChatRequest,
      {
        GROQ_API_KEY: 'gsk_valid_groq_key_123',
      },
      mockFetch as unknown as typeof fetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.provider, 'groq');
    assert.strictEqual(res.fallbackUsed, true);
    assert.strictEqual(groqCalled, 1);
  });

  // Scenario 5: Groq key missing or Groq failure returns safe structured error
  it('5. Groq key missing returns Gemini error; Groq failure returns safe errorInfo', async () => {
    // 5a. Groq key missing: returns Gemini's original error
    const mockGeminiFail = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Resource exhausted',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const resNoGroq = await executeAiChat(
      baseChatRequest,
      {
        GEMINI_API_KEY: 'test-gemini-key',
        // GROQ_API_KEY omitted
      },
      mockGeminiFail as unknown as typeof fetch
    );

    assert.strictEqual(resNoGroq.success, false);
    assert.strictEqual(resNoGroq.code, 'RATE_LIMITED');
    assert.ok(resNoGroq.errorInfo);

    // 5b. Groq also fails (both fail): returns structured error without crashing
    const mockBothFail = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('googleapis.com')) {
        return new Response(
          JSON.stringify({
            error: { code: 429, message: 'Gemini rate limited' },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({
            error: { code: 'rate_limit_exceeded', message: 'Groq rate limit reached' },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const resBothFail = await executeAiChat(
      baseChatRequest,
      {
        GEMINI_API_KEY: 'test-gemini-key',
        GROQ_API_KEY: 'test-groq-key',
      },
      mockBothFail as unknown as typeof fetch
    );

    assert.strictEqual(resBothFail.success, false);
    assert.strictEqual(resBothFail.code, 'RATE_LIMITED');
    assert.ok(resBothFail.errorInfo);
    assert.strictEqual(resBothFail.errorInfo?.retryable, true);
  });

  // Scenario 6: Malformed or fabricated evidence from Groq being rejected
  it('6. Malformed or fabricated evidence from Groq is rejected by application validators', async () => {
    const mockFetchFabricatedGroq = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('googleapis.com')) {
        return new Response('Quota exceeded', { status: 429 });
      }
      if (urlStr.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Fabricated finding from Groq',
                    explanation: 'Groq invented non-existent files and functions.',
                    category: 'security_risk',
                    severity: 'high',
                    evidenceClassification: 'observed', // Groq claims observed
                    evidencePaths: [
                      'src/tasks/validation.js', // Real
                      'src/secret/fake_auth.js', // Hallucinated fake file
                      'nonexistent/passwords.txt', // Hallucinated fake file
                    ],
                    codeEvidence: {
                      filePath: 'src/tasks/validation.js',
                      targetIdentifier: 'hallucinatedMethodNameNotInData', // Fake identifier
                      codeSnippet: 'this code was completely invented by LLM', // Fake excerpt
                      explanation: 'Fabricated proof',
                    },
                    recommendedNextStep: 'Check auth.',
                    uncertainties: 'None.',
                    companionMessages: [{ speaker: 'dog', text: 'Watch out!' }],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await executeRoomInvestigation(
      baseInvestigateRequest,
      {
        GEMINI_API_KEY: 'test-gemini-key',
        GROQ_API_KEY: 'test-groq-key',
      },
      mockFetchFabricatedGroq as unknown as typeof fetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.provider, 'groq');
    const finding = res.finding!;

    // 1. Fabricated files must be stripped from verified evidencePaths and added to rejectedReferences
    assert.ok(finding.rejectedReferences?.includes('src/secret/fake_auth.js'));
    assert.ok(finding.rejectedReferences?.includes('nonexistent/passwords.txt'));
    assert.strictEqual(finding.evidenceReferences.length, 1);
    assert.strictEqual(finding.evidenceReferences[0].path, 'src/tasks/validation.js');

    // 2. Fabricated code snippet and identifier must NOT be accepted as verified evidence
    assert.ok(!finding.codeEvidence || finding.codeEvidence.isVerified === false);

    // 3. Fake 'observed' claim must be demoted to 'inferred'
    assert.notStrictEqual(finding.evidenceClassification, 'observed');
  });

  // Scenario 7: No duplicate submissions, unbounded retries, or leaked credentials
  it('7. No duplicate submissions, bounded retries, and zero leaked credentials', async () => {
    const geminiSecretKey = 'AIzaSySecretGeminiToken123456';
    const groqSecretKey = 'gsk_very_secret_groq_token_abcdef123456';

    let geminiCalls = 0;
    let groqCalls = 0;

    const mockFetchKeyLeaking = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('googleapis.com')) {
        geminiCalls++;
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: `API key not valid: key=${geminiSecretKey}. Please pass a valid key.`,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('api.groq.com')) {
        groqCalls++;
        return new Response(
          JSON.stringify({
            error: {
              code: 'invalid_api_key',
              message: `Invalid API key provided: Bearer ${groqSecretKey}`,
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await executeAiChat(
      baseChatRequest,
      {
        GEMINI_API_KEY: geminiSecretKey,
        GROQ_API_KEY: groqSecretKey,
      },
      mockFetchKeyLeaking as unknown as typeof fetch
    );

    // Exactly 1 call to Gemini, 1 call to Groq (no infinite loops or retry storms)
    assert.strictEqual(geminiCalls, 1, 'Gemini must be called at most once on non-transient error');
    assert.strictEqual(groqCalls, 1, 'Groq must be attempted at most once as fallback');

    // Check zero leaks in error message, detailSafe, and serialized JSON
    const serialized = JSON.stringify(res);
    assert.strictEqual(
      serialized.includes(geminiSecretKey),
      false,
      'Gemini API key MUST NOT appear anywhere in serialized response'
    );
    assert.strictEqual(
      serialized.includes(groqSecretKey),
      false,
      'Groq API key MUST NOT appear anywhere in serialized response'
    );

    // Verify redactSensitiveInfo redacts both key patterns
    const rawLeak = `Bearer ${groqSecretKey} and key=${geminiSecretKey} and GROQ_API_KEY=${groqSecretKey}`;
    const cleaned = redactSensitiveInfo(rawLeak, [geminiSecretKey, groqSecretKey]);
    assert.strictEqual(cleaned.includes(geminiSecretKey), false);
    assert.strictEqual(cleaned.includes(groqSecretKey), false);
    assert.ok(cleaned.includes('[REDACTED]'), 'Secret should be explicitly redacted');
  });

  // Model configuration
  it('8. Supports configurable GROQ_MODEL environment variable and namespaced identifiers', () => {
    assert.strictEqual(DEFAULT_GROQ_MODEL, 'qwen/qwen3.8-27b');

    // Missing GROQ_MODEL defaults to qwen/qwen3.8-27b
    const configDefault = getProviderConfigs({});
    assert.strictEqual(configDefault.groq.model, 'qwen/qwen3.8-27b');

    // Explicit GROQ_MODEL overrides default
    const configCustom = getProviderConfigs({
      GROQ_MODEL: 'custom/model-id-99b',
    });
    assert.strictEqual(configCustom.groq.model, 'custom/model-id-99b');

    // Model identifier validator accepts namespaced IDs containing / and standard characters
    assert.strictEqual(isValidModelIdentifier('qwen/qwen3.8-27b'), true);
    assert.strictEqual(isValidModelIdentifier('meta-llama/llama-4-scout'), true);
    assert.strictEqual(isValidModelIdentifier('gemini-3.8-flash'), true);
    assert.strictEqual(isValidModelIdentifier('gpt-4o_mini.v1'), true);
    assert.strictEqual(isValidModelIdentifier(''), false);
    assert.strictEqual(isValidModelIdentifier('model with spaces'), false);
    assert.strictEqual(isValidModelIdentifier('bad$characters'), false);
  });
});
