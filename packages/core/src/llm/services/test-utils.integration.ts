import { DextoAgent } from '../../agent/DextoAgent.js';
import { resolveApiKeyForProvider, getPrimaryApiKeyEnvVar } from '../../utils/api-key-resolver.js';
import type { LLMProvider } from '../types.js';
import type { AgentConfig } from '../../agent/schemas.js';

/**
 * Shared utilities for LLM service integration tests
 */

export interface TestEnvironment {
    agent: DextoAgent;
    sessionId: string;
    cleanup: () => Promise<void>;
}

/**
 * Creates a test environment with real dependencies (no mocks)
 * Uses DextoAgent to handle complex initialization properly
 */
export async function createTestEnvironment(
    config: AgentConfig,
    sessionId: string = 'test-session'
): Promise<TestEnvironment> {
    const agent = new DextoAgent(config);
    await agent.start();

    return {
        agent,
        sessionId,
        cleanup: async () => {
            if (agent.isStarted()) {
                // Don't wait - just stop the agent immediately
                // The agent.stop() will handle graceful shutdown
                await agent.stop();
            }
        },
    };
}

// Standard test cases have been moved inline to each test file
// This reduces complexity and makes tests more explicit

/**
 * Test configuration helpers that create full AgentConfig objects
 */
export const TestConfigs = {
    /**
     * Creates OpenAI test config
     */
    createOpenAIConfig(): AgentConfig {
        const provider: LLMProvider = 'openai';
        const apiKey = resolveApiKeyForProvider(provider);
        if (!apiKey) {
            throw new Error(
                `${getPrimaryApiKeyEnvVar(provider)} environment variable is required for OpenAI integration tests`
            );
        }

        return {
            systemPrompt: 'You are a helpful assistant for testing purposes.',
            llm: {
                provider,
                model: 'gpt-5-nano', // Use cheapest model for testing
                apiKey,
                maxOutputTokens: 100, // Keep costs low
                temperature: 0, // Deterministic responses
                maxIterations: 1, // Minimal tool iterations
            },
            mcpServers: {},
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            },
            sessions: {
                maxSessions: 10,
                sessionTTL: 60000, // 60s for tests
            },
            logger: {
                level: 'info',
                transports: [{ type: 'console' }],
            },
        };
    },

    /**
     * Creates Anthropic test config
     */
    createAnthropicConfig(): AgentConfig {
        const provider: LLMProvider = 'anthropic';
        const apiKey = resolveApiKeyForProvider(provider);
        if (!apiKey) {
            throw new Error(
                `${getPrimaryApiKeyEnvVar(provider)} environment variable is required for Anthropic integration tests`
            );
        }

        return {
            systemPrompt: 'You are a helpful assistant for testing purposes.',
            llm: {
                provider,
                model: 'claude-haiku-4-5-20251001', // Use cheapest model for testing
                apiKey,
                maxOutputTokens: 100,
                temperature: 0,
                maxIterations: 1,
            },
            mcpServers: {},
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            },
            sessions: {
                maxSessions: 10,
                sessionTTL: 60000,
            },
            logger: {
                level: 'info',
                transports: [{ type: 'console' }],
            },
        };
    },

    /**
     * Creates Vercel test config - parametric for different providers/models
     */
    createVercelConfig(provider: LLMProvider = 'openai', model?: string): AgentConfig {
        const apiKey = resolveApiKeyForProvider(provider);
        if (!apiKey) {
            throw new Error(
                `${getPrimaryApiKeyEnvVar(provider)} environment variable is required for Vercel integration tests with ${provider}`
            );
        }

        // Default models for common providers
        const defaultModels: Record<LLMProvider, string> = {
            openai: 'gpt-5-nano',
            anthropic: 'claude-haiku-4-5-20251001',
            google: 'gemini-2.0-flash',
            groq: 'llama-3.1-8b-instant',
            xai: 'grok-beta',
            cohere: 'command-r',
            'openai-compatible': 'gpt-5-mini',
        };

        return {
            systemPrompt: 'You are a helpful assistant for testing purposes.',
            llm: {
                router: 'vercel', // This is the key difference - uses Vercel router
                provider,
                model: model || defaultModels[provider],
                apiKey,
                maxOutputTokens: 100,
                temperature: 0,
                maxIterations: 1,
            },
            mcpServers: {},
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            },
            sessions: {
                maxSessions: 10,
                sessionTTL: 60000,
            },
            logger: {
                level: 'info',
                transports: [{ type: 'console' }],
            },
        };
    },
} as const;

/**
 * Helper to skip tests if API keys are not available
 */
export function requiresApiKey(provider: LLMProvider): boolean {
    return !!resolveApiKeyForProvider(provider);
}

/**
 * Cleanup helper
 */
export async function cleanupTestEnvironment(_env: TestEnvironment): Promise<void> {
    await _env.cleanup();
}
