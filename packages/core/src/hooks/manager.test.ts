import { describe, expect, it } from 'vitest';
import { HookManager } from './manager.js';
import type { Hook, HookExecutionContext, HookResult } from './types.js';
import type { HookExecutionContextOptions } from './manager.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { HookErrorCode } from './error-codes.js';

function createExecutionContextOptions(): HookExecutionContextOptions {
    const llmConfig = LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        maxIterations: 1,
        maxInputTokens: 1000,
    });

    return {
        sessionManager: {} as unknown as HookExecutionContextOptions['sessionManager'],
        mcpManager: {} as unknown as HookExecutionContextOptions['mcpManager'],
        toolManager: {} as unknown as HookExecutionContextOptions['toolManager'],
        stateManager: {
            getLLMConfig: () => llmConfig,
        } as unknown as HookExecutionContextOptions['stateManager'],
        sessionId: 'session-1',
    };
}

describe('HookManager', () => {
    it('throws when a hook implements no extension points', async () => {
        const logger = createMockLogger();
        const hookManager = new HookManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [{} satisfies Hook],
            logger
        );

        await expect(hookManager.initialize()).rejects.toMatchObject({
            code: HookErrorCode.HOOK_INVALID_SHAPE,
        });
    });

    it('applies modifications in order', async () => {
        const logger = createMockLogger();

        const hookA: Hook = {
            async beforeResponse(payload, _context): Promise<HookResult> {
                return { ok: true, modify: { ...payload, content: 'A' } };
            },
        };

        const hookB: Hook = {
            async beforeResponse(payload, _context): Promise<HookResult> {
                return { ok: true, modify: { ...payload, model: 'B' } };
            },
        };

        const hookManager = new HookManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [hookA, hookB],
            logger
        );
        await hookManager.initialize();

        const options = createExecutionContextOptions();
        const result = await hookManager.executeHooks(
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

        const hook: Hook = {
            async beforeResponse(_payload, _context: HookExecutionContext): Promise<HookResult> {
                return { ok: false, cancel: true, message: 'blocked' };
            },
        };

        const hookManager = new HookManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [hook],
            logger
        );
        await hookManager.initialize();

        const options = createExecutionContextOptions();
        await expect(
            hookManager.executeHooks(
                'beforeResponse',
                { content: 'orig', provider: 'openai' },
                options
            )
        ).rejects.toMatchObject({
            code: HookErrorCode.HOOK_BLOCKED_EXECUTION,
        });
    });

    it('wraps thrown errors as HOOK_EXECUTION_FAILED', async () => {
        const logger = createMockLogger();

        const hook: Hook = {
            async beforeResponse(): Promise<HookResult> {
                throw new Error('boom');
            },
        };

        const hookManager = new HookManager(
            {
                agentEventBus: {} as unknown as import('../events/index.js').AgentEventBus,
                storageManager: {} as unknown as import('../storage/index.js').StorageManager,
            },
            [hook],
            logger
        );
        await hookManager.initialize();

        const options = createExecutionContextOptions();

        let thrown: unknown;
        try {
            await hookManager.executeHooks(
                'beforeResponse',
                { content: 'orig', provider: 'openai' },
                options
            );
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(DextoRuntimeError);
        expect(thrown).toMatchObject({ code: HookErrorCode.HOOK_EXECUTION_FAILED });
    });
});
