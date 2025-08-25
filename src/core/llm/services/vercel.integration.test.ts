import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
    createTestEnvironment,
    TestConfigs,
    requiresApiKey,
    cleanupTestEnvironment,
    TestEnvironment,
} from './test-utils.integration.js';
import { ErrorScope, ErrorType } from '@core/errors/index.js';
import { LLMErrorCode } from '../error-codes.js';

/**
 * Vercel AI SDK LLM Service Integration Tests
 *
 * These tests verify the Vercel AI SDK service works correctly with real API calls.
 * They test multiple providers through the Vercel AI SDK router.
 */
describe('Vercel AI SDK LLM Service Integration', () => {
    let testEnv: TestEnvironment;

    // Test with OpenAI through Vercel AI SDK by default
    const defaultProvider = 'openai';
    const skipTests = !requiresApiKey(defaultProvider);

    beforeEach(async () => {
        if (skipTests) return;

        const config = TestConfigs.createVercelConfig(defaultProvider);
        testEnv = await createTestEnvironment(config);
    });

    afterEach(async () => {
        if (testEnv) {
            await cleanupTestEnvironment(testEnv);
        }
    });

    // Normal operation tests
    test.skipIf(skipTests)(
        'generate works normally',
        async () => {
            const response = await testEnv.agent.run(
                'Hello',
                undefined,
                undefined,
                testEnv.sessionId
            );

            expect(response).toBeTruthy();
            expect(typeof response).toBe('string');
            expect(response.length).toBeGreaterThan(0);
        },
        20000
    );

    test.skipIf(skipTests)('multi-turn generate works normally', async () => {
        const response1 = await testEnv.agent.run(
            'My name is Bob',
            undefined,
            undefined,
            testEnv.sessionId
        );
        const response2 = await testEnv.agent.run(
            'What is my name?',
            undefined,
            undefined,
            testEnv.sessionId
        );

        expect(response1).toBeTruthy();
        expect(response2).toBeTruthy();
        expect(typeof response1).toBe('string');
        expect(typeof response2).toBe('string');
    });

    test.skipIf(skipTests)('stream works normally', async () => {
        const response = await testEnv.agent.run(
            'Hello',
            undefined,
            undefined,
            testEnv.sessionId,
            true
        );

        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
    });

    test.skipIf(skipTests)(
        'multi-turn stream works normally',
        async () => {
            const response1 = await testEnv.agent.run(
                'I like pizza',
                undefined,
                undefined,
                testEnv.sessionId,
                true
            );
            const response2 = await testEnv.agent.run(
                'What do I like?',
                undefined,
                undefined,
                testEnv.sessionId,
                true
            );

            expect(response1).toBeTruthy();
            expect(response2).toBeTruthy();
            expect(typeof response1).toBe('string');
            expect(typeof response2).toBe('string');
        },
        30000
    );

    test.skipIf(skipTests)('creating sessions works normally', async () => {
        const newSession = await testEnv.agent.createSession('test-vercel-session');
        const response = await testEnv.agent.run(
            'Hello in new session',
            undefined,
            undefined,
            newSession.id
        );

        expect(newSession).toBeTruthy();
        expect(newSession.id).toBe('test-vercel-session');
        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
    });

    // Multiple Provider Support through Vercel AI SDK
    test.skipIf(!requiresApiKey('anthropic'))(
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
        }
    );

    test.skipIf(!requiresApiKey('google'))('google through vercel works normally', async () => {
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
    });

    // Error handling tests
    test.skipIf(skipTests)('errors handled with correct error codes', async () => {
        // Test with unsupported file type to trigger validation error
        const invalidFileData = Buffer.from('test data').toString('base64');

        await expect(
            testEnv.agent.run(
                'Process this file',
                undefined,
                {
                    data: invalidFileData,
                    mimeType: 'application/unknown-type',
                    filename: 'test.unknown',
                },
                testEnv.sessionId
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
    });

    // Positive media/file tests (OpenAI via Vercel)
    test.skipIf(!requiresApiKey('openai'))(
        'openai via vercel: image input works',
        async () => {
            const openaiConfig = TestConfigs.createVercelConfig('openai');
            const openaiEnv = await createTestEnvironment(openaiConfig);
            let errorSeen = false;
            const onError = () => {
                errorSeen = true;
            };
            try {
                openaiEnv.agent.agentEventBus.on('llmservice:error', onError);
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
                    openaiEnv.agent.agentEventBus.off('llmservice:error', onError);
                } catch {}
                await cleanupTestEnvironment(openaiEnv);
            }
        },
        30000
    );

    test.skipIf(!requiresApiKey('openai'))(
        'openai via vercel: pdf file input works',
        async () => {
            const openaiConfig = TestConfigs.createVercelConfig('openai');
            const openaiEnv = await createTestEnvironment(openaiConfig);
            let errorSeen = false;
            const onError = () => {
                errorSeen = true;
            };
            try {
                openaiEnv.agent.agentEventBus.on('llmservice:error', onError);
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
                    openaiEnv.agent.agentEventBus.off('llmservice:error', onError);
                } catch {}
                await cleanupTestEnvironment(openaiEnv);
            }
        },
        30000
    );

    test.skipIf(!requiresApiKey('openai'))(
        'openai via vercel: streaming with image works',
        async () => {
            const openaiConfig = TestConfigs.createVercelConfig('openai');
            const openaiEnv = await createTestEnvironment(openaiConfig);
            let errorSeen = false;
            const onError = () => {
                errorSeen = true;
            };
            try {
                openaiEnv.agent.agentEventBus.on('llmservice:error', onError);
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
                    openaiEnv.agent.agentEventBus.off('llmservice:error', onError);
                } catch {}
                await cleanupTestEnvironment(openaiEnv);
            }
        },
        30000
    );

    // Skip test warnings
    if (skipTests) {
        test('Vercel AI SDK integration tests skipped - no API key', () => {
            console.warn(
                `Vercel AI SDK integration tests skipped: ${defaultProvider.toUpperCase()}_API_KEY environment variable not found`
            );
            expect(true).toBe(true); // Placeholder test
        });
    }
});
