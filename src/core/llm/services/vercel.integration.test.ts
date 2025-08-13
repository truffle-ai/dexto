import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
    createTestEnvironment,
    TestConfigs,
    requiresApiKey,
    cleanupTestEnvironment,
    TestEnvironment,
} from './test-utils.integration.js';

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
    test.skipIf(skipTests)('generate works normally', async () => {
        const response = await testEnv.agent.run('Hello', undefined, undefined, testEnv.sessionId);

        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
    });

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

    test.skipIf(skipTests)('multi-turn stream works normally', async () => {
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
    });

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
        const invalidFileData = btoa('test data');

        await expect(async () => {
            await testEnv.agent.run(
                'Process this file',
                undefined,
                {
                    data: invalidFileData,
                    mimeType: 'application/unknown-type',
                    filename: 'test.unknown',
                },
                testEnv.sessionId
            );
        }).rejects.toThrow();
    });

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
