import { describe, expect, it } from 'vitest';
import { PluginManager } from './manager.js';
import type { DextoPlugin, PluginExecutionContext, PluginResult } from './types.js';
import type { ExecutionContextOptions } from './manager.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { PluginErrorCode } from './error-codes.js';

function createExecutionContextOptions(): ExecutionContextOptions {
    const llmConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        maxIterations: 1,
        maxInputTokens: 1000,
    });

    return {
        sessionManager: {} as unknown as ExecutionContextOptions['sessionManager'],
        mcpManager: {} as unknown as ExecutionContextOptions['mcpManager'],
        toolManager: {} as unknown as ExecutionContextOptions['toolManager'],
        stateManager: {
            getLLMConfig: () => llmConfig,
        } as unknown as ExecutionContextOptions['stateManager'],
        sessionId: 'session-1',
    };
}

describe('PluginManager', () => {
    it('throws when a plugin implements no extension points', async () => {
        const logger = createMockLogger();
        const pluginManager = new PluginManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [{} satisfies DextoPlugin],
            logger
        );

        await expect(pluginManager.initialize()).rejects.toMatchObject({
            code: PluginErrorCode.PLUGIN_INVALID_SHAPE,
        });
    });

    it('applies modifications in order', async () => {
        const logger = createMockLogger();

        const pluginA: DextoPlugin = {
            async beforeResponse(payload, _context): Promise<PluginResult> {
                return { ok: true, modify: { ...payload, content: 'A' } };
            },
        };

        const pluginB: DextoPlugin = {
            async beforeResponse(payload, _context): Promise<PluginResult> {
                return { ok: true, modify: { ...payload, model: 'B' } };
            },
        };

        const pluginManager = new PluginManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [pluginA, pluginB],
            logger
        );
        await pluginManager.initialize();

        const options = createExecutionContextOptions();
        const result = await pluginManager.executePlugins(
            'beforeResponse',
            { content: 'orig', provider: 'openai' },
            options
        );

        expect(result).toMatchObject({
            content: 'A',
            provider: 'openai',
            model: 'B',
        });
    });

    it('throws on cancellation', async () => {
        const logger = createMockLogger();

        const plugin: DextoPlugin = {
            async beforeResponse(
                _payload,
                _context: PluginExecutionContext
            ): Promise<PluginResult> {
                return { ok: false, cancel: true, message: 'blocked' };
            },
        };

        const pluginManager = new PluginManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [plugin],
            logger
        );
        await pluginManager.initialize();

        const options = createExecutionContextOptions();
        await expect(
            pluginManager.executePlugins(
                'beforeResponse',
                { content: 'orig', provider: 'openai' },
                options
            )
        ).rejects.toMatchObject({
            code: PluginErrorCode.PLUGIN_BLOCKED_EXECUTION,
        });
    });

    it('wraps thrown errors as PLUGIN_EXECUTION_FAILED', async () => {
        const logger = createMockLogger();

        const plugin: DextoPlugin = {
            async beforeResponse(): Promise<PluginResult> {
                throw new Error('boom');
            },
        };

        const pluginManager = new PluginManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [plugin],
            logger
        );
        await pluginManager.initialize();

        const options = createExecutionContextOptions();

        let thrown: unknown;
        try {
            await pluginManager.executePlugins(
                'beforeResponse',
                { content: 'orig', provider: 'openai' },
                options
            );
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(DextoRuntimeError);
        expect(thrown).toMatchObject({ code: PluginErrorCode.PLUGIN_EXECUTION_FAILED });
    });
});
