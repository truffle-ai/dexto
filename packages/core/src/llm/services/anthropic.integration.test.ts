import { describe, test, expect } from 'vitest';
import {
    createTestEnvironment,
    TestConfigs,
    requiresApiKey,
    cleanupTestEnvironment,
} from './test-utils.integration.js';
import { ErrorScope, ErrorType } from '@core/errors/index.js';
import { LLMErrorCode } from '../error-codes.js';

/**
 * Anthropic LLM Service Integration Tests
 *
 * These tests verify the Anthropic service works correctly with real API calls.
 * They require a valid ANTHROPIC_API_KEY environment variable.
 */
describe('Anthropic LLM Service Integration', () => {
    const skipTests = !requiresApiKey('anthropic');
    const t = skipTests ? test.skip : test.concurrent;

    // Normal operation tests
    t(
        'generate works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createAnthropicConfig());
            try {
                const response = await env.agent.run('Hello', undefined, undefined, env.sessionId);

                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
                expect(response.length).toBeGreaterThan(0);
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        20000
    );

    t(
        'multi-turn generate works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createAnthropicConfig());
            try {
                const response1 = await env.agent.run(
                    'My name is Charlie',
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
        20000
    );

    t(
        'stream works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createAnthropicConfig());
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
        20000
    );

    t(
        'multi-turn stream works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createAnthropicConfig());
            try {
                const response1 = await env.agent.run(
                    'I live in Paris',
                    undefined,
                    undefined,
                    env.sessionId,
                    true
                );
                const response2 = await env.agent.run(
                    'Where do I live?',
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
        20000
    );

    t(
        'creating sessions works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createAnthropicConfig());
            try {
                const newSession = await env.agent.createSession('test-anthropic-session');
                const response = await env.agent.run(
                    'Hello in new session',
                    undefined,
                    undefined,
                    newSession.id
                );

                expect(newSession).toBeTruthy();
                expect(newSession.id).toBe('test-anthropic-session');
                expect(response).toBeTruthy();
                expect(typeof response).toBe('string');
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        20000
    );

    // Error handling tests
    t(
        'errors handled with correct error codes',
        async () => {
            // Test with unsupported file type to trigger validation error
            const invalidFileData = Buffer.from('test data').toString('base64');

            const env = await createTestEnvironment(TestConfigs.createAnthropicConfig());
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
        20000
    );

    // Skip test warning
    if (skipTests) {
        test('Anthropic integration tests skipped - no API key', () => {
            console.warn(
                'Anthropic integration tests skipped: ANTHROPIC_API_KEY environment variable not found'
            );
            expect(true).toBe(true); // Placeholder test
        });
    }
});
