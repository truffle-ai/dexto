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
 * OpenAI LLM Service Integration Tests
 *
 * These tests verify the OpenAI service works correctly with real API calls.
 * They require a valid OPENAI_API_KEY environment variable.
 *
 * Tests focus on verifying response generation, not specific content or capabilities.
 */
describe('OpenAI LLM Service Integration', () => {
    let testEnv: TestEnvironment;

    const skipTests = !requiresApiKey('openai');

    beforeEach(async () => {
        if (skipTests) return;

        const config = TestConfigs.createOpenAIConfig();
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
            'My name is Alice',
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
            'My favorite color is blue',
            undefined,
            undefined,
            testEnv.sessionId,
            true
        );
        const response2 = await testEnv.agent.run(
            'What is my favorite color?',
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
        const newSession = await testEnv.agent.createSession('test-session-new');
        const response = await testEnv.agent.run(
            'Hello in new session',
            undefined,
            undefined,
            newSession.id
        );

        expect(newSession).toBeTruthy();
        expect(newSession.id).toBe('test-session-new');
        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
    });

    test.skipIf(skipTests)('file type works for models supporting files', async () => {
        // gpt-4o-mini supports PDF files according to registry
        const testPdfData = Buffer.from(
            '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n/Contents 4 0 R\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n72 720 Td\n(Hello World) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000079 00000 n \n0000000173 00000 n \n0000000301 00000 n \ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n380\n%%EOF'
        ).toString('base64');

        const response = await testEnv.agent.run(
            'What does this PDF contain?',
            undefined,
            { data: testPdfData, mimeType: 'application/pdf', filename: 'test.pdf' },
            testEnv.sessionId
        );

        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
    });

    test.skipIf(skipTests)('image input works for models supporting images', async () => {
        // Simple test image data (1x1 red pixel PNG base64)
        const testImageData =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

        const response = await testEnv.agent.run(
            'Describe this image',
            { image: testImageData, mimeType: 'image/png' },
            undefined,
            testEnv.sessionId
        );

        expect(response).toBeTruthy();
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
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
        test('OpenAI integration tests skipped - no API key', () => {
            console.warn(
                'OpenAI integration tests skipped: OPENAI_API_KEY environment variable not found'
            );
            expect(true).toBe(true);
        });
    }
});
