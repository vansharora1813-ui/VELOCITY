import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeAiChat, getThinkingConfig, parseAndValidateReplies } from '../src/server/aiProvider.ts';
import { executeRoomInvestigation } from '../src/server/investigationProvider.ts';
import {
  prepareSourceContext,
  buildSystemPrompt,
  clearSourceContextCache,
  getSourceContextCacheSize,
} from '../src/server/contextBuilder.ts';
import type { ChatApiRequest } from '../src/server/types.ts';
import type { InvestigateApiRequest } from '../src/domain/investigation/types.ts';

describe('T16: AI Latency Optimization and Timing Instrumentation', () => {
  beforeEach(() => {
    clearSourceContextCache();
  });

  describe('1. Gemini Thinking Configuration', () => {
    it('defaults to thinkingLevel: "low" for lowest latency on Gemini 3.8 Flash', () => {
      const config = getThinkingConfig({});
      assert.deepEqual(config, { thinkingLevel: 'low' });
    });

    it('honors GEMINI_THINKING_LEVEL="high" when explicitly configured', () => {
      const config = getThinkingConfig({ GEMINI_THINKING_LEVEL: 'high' });
      assert.deepEqual(config, { thinkingLevel: 'high' });
    });

    it('falls back to "low" if invalid or unsupported level is provided', () => {
      const config = getThinkingConfig({ GEMINI_THINKING_LEVEL: 'minimal' });
      assert.deepEqual(config, { thinkingLevel: 'low' });
    });

    it('injects thinkingConfig into executeAiChat payload', async () => {
      let capturedPayload: any = null;
      const mockFetch = async (_url: string, init: any) => {
        capturedPayload = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify([
                        { speaker: 'dog', text: 'All looks clear!' },
                      ]),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 150,
              candidatesTokenCount: 30,
              totalTokenCount: 180,
            },
          }),
          { status: 200 }
        );
      };

      const req: ChatApiRequest = {
        message: 'How is the validation layer looking?',
      };

      const res = await executeAiChat(req, { GEMINI_API_KEY: 'test-key' }, mockFetch as any);
      assert.equal(res.success, true);
      assert.ok(capturedPayload);
      assert.deepEqual(capturedPayload.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
      assert.equal(capturedPayload.generationConfig.maxOutputTokens, 4096);
    });

    it('injects thinkingConfig into executeRoomInvestigation payload', async () => {
      let capturedPayload: any = null;
      const mockFetch = async (_url: string, init: any) => {
        capturedPayload = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        title: 'Test finding',
                        explanation: 'All tests pass.',
                        category: 'unknown',
                        severity: 'info',
                        evidenceClassification: 'observed',
                        evidencePaths: ['src/app.js'],
                        recommendedNextStep: 'Proceed',
                        uncertainties: 'None',
                        companionMessages: [{ speaker: 'dog', text: 'Good' }],
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 300,
              candidatesTokenCount: 90,
              totalTokenCount: 390,
            },
          }),
          { status: 200 }
        );
      };

      const req: InvestigateApiRequest = {
        roomId: 'room-1',
        roomName: 'Gateway',
        roomLayer: 'gateway',
        roomStatus: 'verified',
        roomEvidence: 'All good',
        repoContext: {
          owner: 'test',
          repo: 'demo',
          branch: 'main',
          inspectedFiles: [{ path: 'src/app.js', category: 'source', contentExcerpt: 'console.log(1);' }],
          detectedTechnologies: ['Node.js'],
        },
      };

      const res = await executeRoomInvestigation(req, { GEMINI_API_KEY: 'test-key' }, mockFetch as any);
      assert.equal(res.success, true);
      assert.ok(capturedPayload);
      assert.deepEqual(capturedPayload.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
    });
  });

  describe('2. Execution Timing & Usage Metadata Instrumentation', () => {
    it('chat returns accurate, secret-free timing and token metadata', async () => {
      const mockFetch = async (_url: string, _init: any) => {
        await new Promise((r) => setTimeout(r, 10)); // simulate 10ms upstream latency
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify([
                        { speaker: 'dog', text: 'Barkley is here.' },
                        { speaker: 'cat', text: 'Cleo is watching.' },
                      ]),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 412,
              candidatesTokenCount: 55,
              totalTokenCount: 467,
            },
          }),
          { status: 200 }
        );
      };

      const req: ChatApiRequest = {
        message: 'Tell me about the project',
      };

      const res = await executeAiChat(req, { GEMINI_API_KEY: 'super-secret-key-123' }, mockFetch as any);
      assert.equal(res.success, true);
      assert.ok(res.timing);
      assert.ok(typeof res.timing.totalMs === 'number');
      assert.ok(res.timing.upstreamMs >= 9);
      assert.ok(typeof res.timing.contextPrepMs === 'number');
      assert.ok(typeof res.timing.validationMs === 'number');
      assert.equal(res.timing.promptTokens, 412);
      assert.equal(res.timing.candidatesTokens, 55);
      assert.equal(res.timing.totalTokens, 467);
      assert.equal(res.timing.thinkingLevel, 'low');
      assert.equal(res.timing.finishReason, 'STOP');

      // Verify zero secrets leaked in timing object
      const timingString = JSON.stringify(res.timing);
      assert.equal(timingString.includes('super-secret-key-123'), false);
    });

    it('investigation attaches timing to finding and response', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        title: 'Input validation defect',
                        explanation: 'Whitespace bypassed.',
                        category: 'possible_bug',
                        severity: 'high',
                        evidenceClassification: 'observed',
                        evidencePaths: ['src/validate.js'],
                        recommendedNextStep: 'Trim input',
                        uncertainties: 'None',
                        companionMessages: [{ speaker: 'dog', text: 'Found defect' }],
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 820,
              candidatesTokenCount: 140,
              totalTokenCount: 960,
            },
          }),
          { status: 200 }
        );

      const req: InvestigateApiRequest = {
        roomId: 'room-val',
        roomName: 'Validation',
        roomLayer: 'service',
        roomStatus: 'blocked',
        roomEvidence: 'Failing test',
        repoContext: {
          owner: 'test',
          repo: 'demo',
          branch: 'main',
          inspectedFiles: [{ path: 'src/validate.js', category: 'source', contentExcerpt: 'export function val() {}' }],
          detectedTechnologies: ['JavaScript'],
        },
      };

      const res = await executeRoomInvestigation(req, { GEMINI_API_KEY: 'test-key' }, mockFetch as any);
      assert.equal(res.success, true);
      assert.ok(res.timing);
      assert.equal(res.timing.totalTokens, 960);
      assert.ok(res.finding?.timing);
      assert.equal(res.finding?.timing.totalTokens, 960);
    });
  });

  describe('3. Source Context Caching & Automatic Invalidation', () => {
    const inspectedFiles = [
      { path: 'src/tasks/validation.js', category: 'source', contentExcerpt: 'function validate() { return true; }' },
      { path: 'test/tasks.test.js', category: 'test', contentExcerpt: 'it("works", () => {})' },
    ];

    it('caches identical context preparation calls and avoids repeated string construction', () => {
      assert.equal(getSourceContextCacheSize(), 0);

      const first = prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        selectedRoomFilePaths: ['src/tasks/validation.js'],
      });

      assert.equal(getSourceContextCacheSize(), 1);

      const second = prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        selectedRoomFilePaths: ['src/tasks/validation.js'],
      });

      // Strict referential equality proves result came directly from cache
      assert.strictEqual(first, second);
      assert.equal(getSourceContextCacheSize(), 1);
    });

    it('automatically invalidates cache when selectedRoomId changes', () => {
      prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        selectedRoomFilePaths: ['src/tasks/validation.js'],
      });

      assert.equal(getSourceContextCacheSize(), 1);

      // Request for different room
      prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-routes',
        selectedRoomFilePaths: ['src/routes.js'],
      });

      // New entry created for different room
      assert.equal(getSourceContextCacheSize(), 2);
    });

    it('automatically invalidates cache when inspected files change (new scan or commit)', () => {
      prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        selectedRoomFilePaths: ['src/tasks/validation.js'],
      });

      const updatedFiles = [
        ...inspectedFiles,
        { path: 'src/newFile.js', category: 'source', contentExcerpt: 'export const x = 1;' },
      ];

      prepareSourceContext({
        inspectedFiles: updatedFiles,
        selectedRoomId: 'room-val',
        selectedRoomFilePaths: ['src/tasks/validation.js'],
      });

      assert.equal(getSourceContextCacheSize(), 2);
    });

    it('automatically invalidates cache when commitSha changes', () => {
      prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        commitSha: 'commit-aaa111',
      });
      assert.equal(getSourceContextCacheSize(), 1);

      prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        commitSha: 'commit-bbb222',
      });
      assert.equal(getSourceContextCacheSize(), 2);
    });

    it('clearSourceContextCache clears all stored context', () => {
      prepareSourceContext({
        inspectedFiles,
        selectedRoomId: 'room-val',
        selectedRoomFilePaths: ['src/tasks/validation.js'],
      });
      assert.equal(getSourceContextCacheSize(), 1);

      clearSourceContextCache();
      assert.equal(getSourceContextCacheSize(), 0);
    });
  });

  describe('4. Payload Optimization & Grounding Preservation', () => {
    it('chat prompt uses focused budget (8,000 chars) while preserving selected room source', () => {
      const req: ChatApiRequest = {
        message: 'Explain validateTaskTitle',
        selectedRoomId: 'room-val',
        repoContext: {
          owner: 'sakshamgupta005',
          repo: 'patchboard-tasks-api',
          branch: 'main',
          commitSha: '4ddfe585adbccd57794efba49ca1102ff654382f',
          totalFiles: 18,
          detectedTechnologies: ['Node.js'],
          inspectedFiles: [
            {
              path: 'src/tasks/validation.js',
              category: 'source',
              contentExcerpt: 'function validateTaskTitle(title) { if (title.length === 0) return false; }',
            },
            {
              path: 'test/createTask.test.js',
              category: 'test',
              contentExcerpt: 'it("rejects whitespace-only task titles", () => { ... })',
            },
          ],
          roomSummaries: [
            {
              id: 'room-val',
              name: 'Validation',
              status: 'blocked',
              evidence: 'Failing CI test',
              filePaths: ['src/tasks/validation.js', 'test/createTask.test.js'],
            },
          ],
        },
      };

      const prompt = buildSystemPrompt(req);
      assert.ok(prompt.includes('validateTaskTitle(title)'));
      assert.ok(prompt.includes('test/createTask.test.js'));
      assert.ok(prompt.includes('SCANNED COMMIT SHA: 4ddfe585adbccd57794efba49ca1102ff654382f'));
      assert.ok(prompt.length < 12000, `Expected prompt length < 12,000, got ${prompt.length}`);
    });
  });

  describe('5. Conversational Personas & Response Formats', () => {
    it('handles dog-only response without error', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify([{ speaker: 'dog', text: 'All looks clean!' }]),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200 }
        );

      const res = await executeAiChat({ message: 'Hello' }, { GEMINI_API_KEY: 'test-key' }, mockFetch as any);
      assert.equal(res.success, true);
      assert.equal(res.replies?.length, 1);
      assert.equal(res.replies?.[0].speaker, 'dog');
    });

    it('handles dog and cat dual-companion responses', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify([
                        { speaker: 'dog', text: 'I see 12 files.' },
                        { speaker: 'cat', text: 'One CI test is failing.' },
                      ]),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200 }
        );

      const res = await executeAiChat({ message: 'Review' }, { GEMINI_API_KEY: 'test-key' }, mockFetch as any);
      assert.equal(res.success, true);
      assert.equal(res.replies?.length, 2);
      assert.equal(res.replies?.[0].speaker, 'dog');
      assert.equal(res.replies?.[1].speaker, 'cat');
    });

    it('validates natural explanatory responses without truncating multi-sentence teaching explanations', () => {
      const longTeachingText =
        'The problem is that the code checks whether the title is an empty string, but a string containing only spaces isn\'t technically empty. So it slips past validation. The code trims those spaces later, which can leave an empty title behind. The failing test checks exactly this case. In software architecture, input validation at the boundary must sanitize and reject invalid inputs before they reach core storage.';
      const res = parseAndValidateReplies(
        JSON.stringify([
          { speaker: 'dog', text: longTeachingText },
        ])
      );
      assert.equal(res.length, 1);
      assert.equal(res[0].speaker, 'dog');
      assert.equal(res[0].text, longTeachingText);
    });

    it('buildSystemPrompt provides natural teaching goals without rigid 1-3 sentence constraints', () => {
      const req: ChatApiRequest = {
        message: 'How does this project work?',
      };
      const prompt = buildSystemPrompt(req);
      assert.ok(prompt.includes('Primary Teacher'));
      assert.ok(prompt.includes('Occasional Reviewer'));
      assert.ok(!prompt.includes('(1-3 sentences)'));
      assert.ok(prompt.includes('STYLE REFERENCE EXAMPLE'));
    });
  });
});
