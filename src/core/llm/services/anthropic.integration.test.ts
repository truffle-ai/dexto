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
 * Anthropic LLM Service Integration Tests
 *
 * These tests verify the Anthropic service works correctly with real API calls.
 * They require a valid ANTHROPIC_API_KEY environment variable.
 */
describe('Anthropic LLM Service Integration', () => {
    let testEnv: TestEnvironment;

    const skipTests = !requiresApiKey('anthropic');

    beforeEach(async () => {
        if (skipTests) return;

        const config = TestConfigs.createAnthropicConfig();
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
            'My name is Charlie',
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
            'I live in Paris',
            undefined,
            undefined,
            testEnv.sessionId,
            true
        );
        const response2 = await testEnv.agent.run(
            'Where do I live?',
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
        const newSession = await testEnv.agent.createSession('test-anthropic-session');
        const response = await testEnv.agent.run(
            'Hello in new session',
            undefined,
            undefined,
            newSession.id
        );

        expect(newSession).toBeTruthy();
        expect(newSession.id).toBe('test-anthropic-session');
        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
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
