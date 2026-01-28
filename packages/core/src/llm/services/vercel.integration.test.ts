import { describe, test, expect } from 'vitest';
import {
    createTestEnvironment,
    TestConfigs,
    requiresApiKey,
    cleanupTestEnvironment,
} from './test-utils.integration.js';
import { ErrorScope, ErrorType } from '@core/errors/index.js';
import { LLMErrorCode } from '../error-codes.js';
import { resolveApiKeyForProvider } from '@core/utils/api-key-resolver.js';
import type { LLMProvider } from '@core/llm/types.js';

/**
 * Vercel AI SDK LLM Service Integration Tests
 *
 * These tests verify the Vercel AI SDK service works correctly with real API calls.
 * They test multiple providers through the Vercel AI SDK.
 */
describe('Vercel AI SDK LLM Service Integration', () => {
    // Test with OpenAI through Vercel AI SDK by default
    const defaultProvider = 'openai';
    const RUN_EXTERNAL_LLM_TESTS =
        process.env.DEXTO_RUN_EXTERNAL_LLM_TESTS === 'true' ||
        process.env.DEXTO_RUN_EXTERNAL_LLM_TESTS === '1';

    const canRunProvider = (provider: LLMProvider): boolean => {
        if (!RUN_EXTERNAL_LLM_TESTS) return false;
        return !requiresApiKey(provider) || Boolean(resolveApiKeyForProvider(provider));
    };

    const t = canRunProvider(defaultProvider) ? test.concurrent : test.skip;
    const skipTests = !canRunProvider(defaultProvider);

    // Normal operation tests
    t(
        'generate works normally',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig(defaultProvider)
            );
            try {
                const response = await env.agent.run('Hello', undefined, undefined, env.sessionId);

                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
                expect(response.length).toBeGreaterThan(0);
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );

    t(
        'multi-turn generate works normally',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig(defaultProvider)
            );
            try {
                const response1 = await env.agent.run(
                    'My name is Bob',
                    undefined,
                    undefined,
                    env.sessionId
                );
                const response2 = await env.agent.run(
                    'What is my name?',
                    undefined,
                    undefined,
                    env.sessionId
                );

                expect(response1).toBeTruthy();
                expect(response2).toBeTruthy();
                expect(typeof response1).toBe('string');
                expect(typeof response2).toBe('string');
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );

    t(
        'stream works normally',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig(defaultProvider)
            );
            try {
                const response = await env.agent.run(
                    'Hello',
                    undefined,
                    undefined,
                    env.sessionId,
                    true
                );

                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
                expect(response.length).toBeGreaterThan(0);
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );

    t(
        'multi-turn stream works normally',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig(defaultProvider)
            );
            try {
                const response1 = await env.agent.run(
                    'I like pizza',
                    undefined,
                    undefined,
                    env.sessionId,
                    true
                );
                const response2 = await env.agent.run(
                    'What do I like?',
                    undefined,
                    undefined,
                    env.sessionId,
                    true
                );

                expect(response1).toBeTruthy();
                expect(response2).toBeTruthy();
                expect(typeof response1).toBe('string');
                expect(typeof response2).toBe('string');
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );

    t(
        'creating sessions works normally',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig(defaultProvider)
            );
            try {
                const newSession = await env.agent.createSession('test-vercel-session');
                const response = await env.agent.run(
                    'Hello in new session',
                    undefined,
                    undefined,
                    newSession.id
                );

                expect(newSession).toBeTruthy();
                expect(newSession.id).toBe('test-vercel-session');
                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );

    // Multiple Provider Support through Vercel AI SDK
    (canRunProvider('anthropic') ? test.concurrent : test.skip)(
        'anthropic through vercel works normally',
        async () => {
            const anthropicConfig = TestConfigs.createVercelConfig('anthropic');
            const anthropicEnv = await createTestEnvironment(anthropicConfig);

            try {
                const response = await anthropicEnv.agent.run(
                    'Hello',
                    undefined,
                    undefined,
                    anthropicEnv.sessionId
                );

                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
                expect(response.length).toBeGreaterThan(0);
            } finally {
                await cleanupTestEnvironment(anthropicEnv);
            }
        },
        60000
    );

    (canRunProvider('google') ? test.concurrent : test.skip)(
        'google through vercel works normally',
        async () => {
            const googleConfig = TestConfigs.createVercelConfig('google');
            const googleEnv = await createTestEnvironment(googleConfig);

            try {
                const response = await googleEnv.agent.run(
                    'Hello',
                    undefined,
                    undefined,
                    googleEnv.sessionId
                );

                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
                expect(response.length).toBeGreaterThan(0);
            } finally {
                await cleanupTestEnvironment(googleEnv);
            }
        },
        60000
    );

    // Error handling tests
    t(
        'errors handled with correct error codes',
        async () => {
            // Test with unsupported file type to trigger validation error
            const invalidFileData = Buffer.from('test data').toString('base64');

            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig(defaultProvider)
            );
            try {
                await expect(
                    env.agent.run(
                        'Process this file',
                        undefined,
                        {
                            data: invalidFileData,
                            mimeType: 'application/unknown-type',
                            filename: 'test.unknown',
                        },
                        env.sessionId
                    )
                ).rejects.toMatchObject({
                    issues: [
                        expect.objectContaining({
                            code: LLMErrorCode.INPUT_FILE_UNSUPPORTED,
                            scope: ErrorScope.LLM,
                            type: ErrorType.USER,
                        }),
                    ],
                });
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );

    // Positive media/file tests (OpenAI via Vercel)
    (requiresApiKey('openai') ? test.concurrent : test.skip)(
        'openai via vercel: image input works',
        async () => {
            const openaiConfig = TestConfigs.createVercelConfig('openai');
            const openaiEnv = await createTestEnvironment(openaiConfig);
            let errorSeen = false;
            const onError = () => {
                errorSeen = true;
            };
            try {
                openaiEnv.agent.agentEventBus.on('llm:error', onError);
                // 1x1 PNG (red pixel) base64 (no data URI), minimal cost
                const imgBase64 =
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

                const res = await openaiEnv.agent.run(
                    'What is in the image?',
                    { image: imgBase64, mimeType: 'image/png' },
                    undefined,
                    openaiEnv.sessionId
                );

                expect(typeof res).toBe('string');
                expect(res.length).toBeGreaterThan(0);
                expect(errorSeen).toBe(false);
            } finally {
                // cleanup listener
                try {
                    openaiEnv.agent.agentEventBus.off('llm:error', onError);
                } catch (_e) {
                    void 0; // ignore
                }
                await cleanupTestEnvironment(openaiEnv);
            }
        },
        60000
    );

    (requiresApiKey('openai') ? test.concurrent : test.skip)(
        'openai via vercel: pdf file input works',
        async () => {
            const openaiConfig = TestConfigs.createVercelConfig('openai');
            const openaiEnv = await createTestEnvironment(openaiConfig);
            let errorSeen = false;
            const onError = () => {
                errorSeen = true;
            };
            try {
                openaiEnv.agent.agentEventBus.on('llm:error', onError);
                // Valid tiny PDF (Hello World) base64 from OpenAI tests
                const pdfBase64 =
                    'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovQ29udGVudHMgNCAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjcyIDcyMCBUZAooSGVsbG8gV29ybGQpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNzkgMDAwMDAgbiAKMDAwMDAwMDE3MyAwMDAwMCBuIAowMDAwMDAwMzAxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNQovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMzgwCiUlRU9G';

                const res = await openaiEnv.agent.run(
                    'Summarize this PDF',
                    undefined,
                    { data: pdfBase64, mimeType: 'application/pdf', filename: 'test.pdf' },
                    openaiEnv.sessionId
                );

                expect(typeof res).toBe('string');
                expect(res.length).toBeGreaterThan(0);
                expect(errorSeen).toBe(false);
            } finally {
                try {
                    openaiEnv.agent.agentEventBus.off('llm:error', onError);
                } catch (_e) {
                    void 0; // ignore
                }
                await cleanupTestEnvironment(openaiEnv);
            }
        },
        60000
    );

    (requiresApiKey('openai') ? test.concurrent : test.skip)(
        'openai via vercel: streaming with image works',
        async () => {
            const openaiConfig = TestConfigs.createVercelConfig('openai');
            const openaiEnv = await createTestEnvironment(openaiConfig);
            let errorSeen = false;
            const onError = () => {
                errorSeen = true;
            };
            try {
                openaiEnv.agent.agentEventBus.on('llm:error', onError);
                const imgBase64 =
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

                const res = await openaiEnv.agent.run(
                    'Describe this image in one sentence',
                    { image: imgBase64, mimeType: 'image/png' },
                    undefined,
                    openaiEnv.sessionId,
                    true
                );

                expect(typeof res).toBe('string');
                expect(res.length).toBeGreaterThan(0);
                expect(errorSeen).toBe(false);
            } finally {
                try {
                    openaiEnv.agent.agentEventBus.off('llm:error', onError);
                } catch (_e) {
                    void 0; // ignore
                }
                await cleanupTestEnvironment(openaiEnv);
            }
        },
        60000
    );

    // Skip test warnings
    if (skipTests) {
        test('Vercel AI SDK integration tests skipped - no API key', () => {
            console.warn(
                `Vercel AI SDK integration tests skipped. ` +
                    `Set DEXTO_RUN_EXTERNAL_LLM_TESTS=1 and provide a valid ${defaultProvider.toUpperCase()}_API_KEY to run them.`
            );
            expect(true).toBe(true); // Placeholder test
        });
    }
});
