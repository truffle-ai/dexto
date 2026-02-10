// NOTE: Shared helpers for LLM service integration tests (not itself a test file).
import { DextoAgent } from '../../agent/DextoAgent.js';
import {
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
    PROVIDER_API_KEY_MAP,
} from '../../utils/api-key-resolver.js';
import type { LLMProvider } from '../types.js';
import type { AgentRuntimeConfig } from '../../agent/runtime-config.js';
import { SystemPromptConfigSchema } from '../../systemPrompt/schemas.js';
import { LLMConfigSchema } from '../schemas.js';
import { LoggerConfigSchema } from '../../logger/v2/schemas.js';
import { StorageSchema, createStorageManager, type ValidatedStorageConfig } from '@dexto/storage';
import { SessionConfigSchema } from '../../session/schemas.js';
import { ToolConfirmationConfigSchema, ElicitationConfigSchema } from '../../tools/schemas.js';
import { ServerConfigsSchema } from '../../mcp/schemas.js';
import { InternalResourcesSchema } from '../../resources/schemas.js';
import { PromptsSchema } from '../../prompts/schemas.js';
import { PluginsConfigSchema } from '../../plugins/schemas.js';
import {
    CompactionConfigSchema,
    DEFAULT_COMPACTION_CONFIG,
} from '../../context/compaction/schemas.js';
import { createLogger } from '../../logger/factory.js';

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
    config: AgentRuntimeConfig,
    sessionId: string = 'test-session'
): Promise<TestEnvironment> {
    const logger = createLogger({
        config: config.logger,
        agentId: config.agentId,
    });
    const storageManager = await createStorageManager(
        config.storage as ValidatedStorageConfig,
        logger
    );
    const agent = new DextoAgent({ config, logger, overrides: { storageManager } });
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
    createOpenAIConfig(): AgentRuntimeConfig {
        const provider: LLMProvider = 'openai';
        const apiKey = resolveApiKeyForProvider(provider);
        if (!apiKey) {
            throw new Error(
                `${getPrimaryApiKeyEnvVar(provider)} environment variable is required for OpenAI integration tests`
            );
        }

        return {
            systemPrompt: SystemPromptConfigSchema.parse(
                'You are a helpful assistant for testing purposes.'
            ),
            llm: LLMConfigSchema.parse({
                provider,
                model: 'gpt-4o-mini', // Use cheapest non-reasoning model for testing
                apiKey,
                maxOutputTokens: 1000, // Enough for reasoning models (reasoning + answer)
                temperature: 0, // Deterministic responses
                maxIterations: 1, // Minimal tool iterations
            }),
            agentFile: { discoverInCwd: false },
            agentId: 'test-agent',
            mcpServers: ServerConfigsSchema.parse({}),
            tools: [],
            storage: StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            }),
            sessions: SessionConfigSchema.parse({
                maxSessions: 10,
                sessionTTL: 60000, // 60s for tests
            }),
            logger: LoggerConfigSchema.parse({
                level: 'info',
                transports: [{ type: 'console' }],
            }),
            toolConfirmation: ToolConfirmationConfigSchema.parse({
                mode: 'auto-approve', // Tests don't have interactive approval
                timeout: 120000,
            }),
            elicitation: ElicitationConfigSchema.parse({
                enabled: false, // Tests don't handle elicitation
                timeout: 120000,
            }),
            internalResources: InternalResourcesSchema.parse([]),
            prompts: PromptsSchema.parse([]),
            plugins: PluginsConfigSchema.parse({}),
            compaction: CompactionConfigSchema.parse(DEFAULT_COMPACTION_CONFIG),
        };
    },

    /**
     * Creates Anthropic test config
     */
    createAnthropicConfig(): AgentRuntimeConfig {
        const provider: LLMProvider = 'anthropic';
        const apiKey = resolveApiKeyForProvider(provider);
        if (!apiKey) {
            throw new Error(
                `${getPrimaryApiKeyEnvVar(provider)} environment variable is required for Anthropic integration tests`
            );
        }

        return {
            systemPrompt: SystemPromptConfigSchema.parse(
                'You are a helpful assistant for testing purposes.'
            ),
            llm: LLMConfigSchema.parse({
                provider,
                model: 'claude-haiku-4-5-20251001', // Use cheapest model for testing
                apiKey,
                maxOutputTokens: 1000, // Enough for reasoning models (reasoning + answer)
                temperature: 0,
                maxIterations: 1,
            }),
            agentFile: { discoverInCwd: false },
            agentId: 'test-agent',
            mcpServers: ServerConfigsSchema.parse({}),
            tools: [],
            storage: StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            }),
            sessions: SessionConfigSchema.parse({
                maxSessions: 10,
                sessionTTL: 60000,
            }),
            logger: LoggerConfigSchema.parse({
                level: 'info',
                transports: [{ type: 'console' }],
            }),
            toolConfirmation: ToolConfirmationConfigSchema.parse({
                mode: 'auto-approve', // Tests don't have interactive approval
                timeout: 120000,
            }),
            elicitation: ElicitationConfigSchema.parse({
                enabled: false, // Tests don't handle elicitation
                timeout: 120000,
            }),
            internalResources: InternalResourcesSchema.parse([]),
            prompts: PromptsSchema.parse([]),
            plugins: PluginsConfigSchema.parse({}),
            compaction: CompactionConfigSchema.parse(DEFAULT_COMPACTION_CONFIG),
        };
    },

    /**
     * Creates Vercel test config - parametric for different providers/models
     */
    createVercelConfig(provider: LLMProvider = 'openai', model?: string): AgentRuntimeConfig {
        const apiKey = resolveApiKeyForProvider(provider);
        // Only enforce API key check for providers that require it (exclude local, ollama, vertex with empty key maps)
        if (!apiKey && providerRequiresApiKey(provider)) {
            throw new Error(
                `${getPrimaryApiKeyEnvVar(provider)} environment variable is required for Vercel integration tests with ${provider}`
            );
        }

        // Default models for common providers
        const defaultModels: Record<LLMProvider, string> = {
            openai: 'gpt-4o-mini',
            anthropic: 'claude-haiku-4-5-20251001',
            google: 'gemini-2.0-flash',
            groq: 'llama-3.1-8b-instant',
            xai: 'grok-beta',
            cohere: 'command-r',
            minimax: 'MiniMax-M2.1',
            glm: 'glm-4.7',
            'openai-compatible': 'gpt-5-mini',
            openrouter: 'anthropic/claude-3.5-haiku', // OpenRouter model format: provider/model
            litellm: 'gpt-4', // LiteLLM model names follow the provider's convention
            glama: 'openai/gpt-4o', // Glama model format: provider/model
            vertex: 'gemini-2.5-pro', // Vertex AI uses ADC auth, not API keys
            bedrock: 'anthropic.claude-3-5-haiku-20241022-v1:0', // Bedrock uses AWS credentials, not API keys
            local: 'llama-3.2-3b-q4', // Native node-llama-cpp GGUF models
            ollama: 'llama3.2', // Ollama server models
            dexto: 'anthropic/claude-4.5-sonnet', // Dexto gateway (OpenRouter model format)
        };

        return {
            systemPrompt: SystemPromptConfigSchema.parse(
                'You are a helpful assistant for testing purposes.'
            ),
            llm: LLMConfigSchema.parse({
                provider,
                model: model || defaultModels[provider],
                apiKey,
                maxOutputTokens: 1000, // Enough for reasoning models (reasoning + answer)
                temperature: 0,
                maxIterations: 1,
            }),
            agentFile: { discoverInCwd: false },
            agentId: 'test-agent',
            mcpServers: ServerConfigsSchema.parse({}),
            storage: StorageSchema.parse({
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/test-blobs' },
            }),
            sessions: SessionConfigSchema.parse({
                maxSessions: 10,
                sessionTTL: 60000,
            }),
            logger: LoggerConfigSchema.parse({
                level: 'info',
                transports: [{ type: 'console' }],
            }),
            toolConfirmation: ToolConfirmationConfigSchema.parse({
                mode: 'auto-approve', // Tests don't have interactive approval
                timeout: 120000,
            }),
            elicitation: ElicitationConfigSchema.parse({
                enabled: false, // Tests don't handle elicitation
                timeout: 120000,
            }),
            tools: [],
            internalResources: InternalResourcesSchema.parse([]),
            prompts: PromptsSchema.parse([]),
            plugins: PluginsConfigSchema.parse({}),
            compaction: CompactionConfigSchema.parse(DEFAULT_COMPACTION_CONFIG),
        };
    },
} as const;

/**
 * Helper to check if a provider requires an API key
 * Providers with empty arrays in PROVIDER_API_KEY_MAP don't require API keys (e.g., local, ollama, vertex)
 */
export function providerRequiresApiKey(provider: LLMProvider): boolean {
    const envVars = PROVIDER_API_KEY_MAP[provider];
    return envVars && envVars.length > 0;
}

/**
 * Helper to check if API key is available for a provider
 * Used to skip tests when API keys are not configured
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
