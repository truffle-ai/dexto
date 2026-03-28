import { describe, test, expect } from 'vitest';
import {
    createTestEnvironment,
    TestConfigs,
    providerRequiresApiKey,
    cleanupTestEnvironment,
} from './test-utils.integration.js';
import { resolveApiKeyForProvider } from '../../utils/api-key-resolver.js';

/**
 * MiniMax M2.7 Integration Tests
 *
 * These tests verify the MiniMax provider works correctly with real API calls
 * using the latest M2.7 model through the OpenAI-compatible endpoint.
 *
 * Requires: MINIMAX_API_KEY env var and DEXTO_RUN_EXTERNAL_LLM_TESTS=true
 */
describe('MiniMax M2.7 Integration', () => {
    const RUN_EXTERNAL_LLM_TESTS =
        process.env.DEXTO_RUN_EXTERNAL_LLM_TESTS === 'true' ||
        process.env.DEXTO_RUN_EXTERNAL_LLM_TESTS === '1';

    const canRunMinimax =
        RUN_EXTERNAL_LLM_TESTS &&
        (!providerRequiresApiKey('minimax') || Boolean(resolveApiKeyForProvider('minimax')));

    const t = canRunMinimax ? test : test.skip;

    t(
        'M2.7 generates a response',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig('minimax', 'MiniMax-M2.7')
            );
            try {
                const response = await env.agent.run(
                    'Reply with exactly: Hello from MiniMax',
                    undefined,
                    undefined,
                    env.sessionId
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
        'M2.7-highspeed generates a response',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig('minimax', 'MiniMax-M2.7-highspeed')
            );
            try {
                const response = await env.agent.run(
                    'Reply with exactly: Hello from MiniMax highspeed',
                    undefined,
                    undefined,
                    env.sessionId
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
        'M2.7 handles multi-turn conversation',
        async () => {
            const env = await createTestEnvironment(
                TestConfigs.createVercelConfig('minimax', 'MiniMax-M2.7')
            );
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
                expect(typeof response2).toBe('string');
            } finally {
                await cleanupTestEnvironment(env);
            }
        },
        60000
    );
});
