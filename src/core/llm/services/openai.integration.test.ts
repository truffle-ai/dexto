import { describe, test, expect } from 'vitest';
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
 * OpenAI LLM Service Integration Tests
 *
 * These tests verify the OpenAI service works correctly with real API calls.
 * They require a valid OPENAI_API_KEY environment variable.
 *
 * Tests focus on verifying response generation, not specific content or capabilities.
 */
describe('OpenAI LLM Service Integration', () => {
    const skipTests = !requiresApiKey('openai');
    const t = skipTests ? test.skip : test.concurrent;

    // Normal operation tests
    t('generate works normally', async () => {
        const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
        try {
            const response = await env.agent.run('Hello', undefined, undefined, env.sessionId);

            expect(response).toBeTruthy();
            expect(typeof response).toBe('string');
            expect(response.length).toBeGreaterThan(0);
        } finally {
            await cleanupTestEnvironment(env);
        }
    });

    t(
        'multi-turn generate works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
            try {
                const response1 = await env.agent.run(
                    'My name is Alice',
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

    t('stream works normally', async () => {
        const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
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
    });

    t(
        'multi-turn stream works normally',
        async () => {
            const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
            try {
                const response1 = await env.agent.run(
                    'My favorite color is blue',
                    undefined,
                    undefined,
                    env.sessionId,
                    true
                );
                const response2 = await env.agent.run(
                    'What is my favorite color?',
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

    t('creating sessions works normally', async () => {
        const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
        try {
            const newSession = await env.agent.createSession('test-session-new');
            const response = await env.agent.run(
                'Hello in new session',
                undefined,
                undefined,
                newSession.id
            );

            expect(newSession).toBeTruthy();
            expect(newSession.id).toBe('test-session-new');
            expect(response).toBeTruthy();
            expect(typeof response).toBe('string');
        } finally {
            await cleanupTestEnvironment(env);
        }
    });

    t('file type works for models supporting files', async () => {
        // gpt-4o-mini supports PDF files according to registry
        const testPdfData = Buffer.from(
            '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n/Contents 4 0 R\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n72 720 Td\n(Hello World) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000079 00000 n \n0000000173 00000 n \n0000000301 00000 n \ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n380\n%%EOF'
        ).toString('base64');
        const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
        try {
            const response = await env.agent.run(
                'What does this PDF contain?',
                undefined,
                { data: testPdfData, mimeType: 'application/pdf', filename: 'test.pdf' },
                env.sessionId
            );

            expect(response).toBeTruthy();
            expect(typeof response).toBe('string');
            expect(response.length).toBeGreaterThan(0);
        } finally {
            await cleanupTestEnvironment(env);
        }
    });

    t('image input works for models supporting images', async () => {
        // Simple test image data (1x1 red pixel PNG base64)
        const testImageData =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

        const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
        try {
            const response = await env.agent.run(
                'Describe this image',
                { image: testImageData, mimeType: 'image/png' },
                undefined,
                env.sessionId
            );

            expect(response).toBeTruthy();
            expect(typeof response).toBe('string');
            expect(response.length).toBeGreaterThan(0);
        } finally {
            await cleanupTestEnvironment(env);
        }
    });

    // Error handling tests
    t('errors handled with correct error codes', async () => {
        // Test with unsupported file type to trigger validation error
        const invalidFileData = Buffer.from('test data').toString('base64');

        const env = await createTestEnvironment(TestConfigs.createOpenAIConfig());
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
    });

    // Skip test warning
    if (skipTests) {
        test('OpenAI integration tests skipped - no API key', () => {
            console.warn(
                'OpenAI integration tests skipped: OPENAI_API_KEY environment variable not found'
            );
            expect(true).toBe(true);
        });
    }
});
