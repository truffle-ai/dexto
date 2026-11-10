import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel, ModelMessage } from 'ai';
import type { LLMContext, LLMProvider } from '@dexto/llm';
import { TurnExecutor } from './turn-executor.js';
import { ContextManager } from '../../context/manager.js';
import { ToolManager } from '../../tools/tool-manager.js';
import { defineTool } from '../../tools/define-tool.js';
import { SessionEventBus, AgentEventBus } from '../../events/index.js';
import { ResourceManager } from '../../resources/index.js';
import { MessageQueueService } from '../../session/message-queue.js';
import { SystemPromptManager } from '../../systemPrompt/manager.js';
import { SystemPromptConfigSchema } from '../../systemPrompt/schemas.js';
import { VercelMessageFormatter } from '../formatters/vercel.js';
import { MCPManager } from '../../mcp/manager.js';
import { ApprovalManager } from '../../approval/manager.js';
import { createLogger } from '../../logger/factory.js';
import { MemoryManager } from '../../memory/index.js';
import type { Logger } from '../../logger/v2/types.js';
import type { ValidatedLLMConfig } from '../schemas.js';
import { InMemoryDextoStores, InMemoryToolOutputStore } from '../../storage/stores/in-memory.js';
import type { DextoStores } from '../../storage/index.js';
import {
    createInMemoryMessageQueueStore,
    createInMemorySessionApprovalStore,
    createInMemorySessionToolPreferencesStore,
} from '../../test-utils/session-state-stores.js';

/**
 * A two-step tool loop through the real AI SDK and `@openrouter/ai-sdk-provider` (the client
 * `dexto-nova` and `openrouter` use), against a fake OpenRouter-compatible upstream. Anthropic
 * requires the tool-calling turn's thinking blocks back, unchanged, beside the tool result.
 */

type ChatRequestBody = {
    messages: Array<{ role: string; reasoning_details?: unknown; tool_calls?: unknown[] }>;
};

const SIGNED_EMPTY_THINKING = {
    type: 'reasoning.text',
    text: '',
    signature: 'sig-tool-turn',
    format: 'anthropic-claude-v1',
    index: 0,
};
const REDACTED_THINKING = {
    type: 'reasoning.encrypted',
    data: 'redacted-blob',
    format: 'anthropic-claude-v1',
    index: 1,
};

function sse(chunks: unknown[]): Response {
    const body =
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null) {
    return {
        id: 'gen-1',
        object: 'chat.completion.chunk',
        created: 0,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(finishReason && {
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
    };
}

function toolCallDelta(index: number, id: string) {
    return {
        index,
        id,
        type: 'function',
        function: { name: 'lookup', arguments: '{}' },
    };
}

function createFakeGateway(model: string, toolCallIds: string[]) {
    const requests: ChatRequestBody[] = [];
    const fetchImpl = async (_input: unknown, init?: RequestInit): Promise<Response> => {
        requests.push(JSON.parse(String(init?.body)) as ChatRequestBody);
        if (requests.length === 1) {
            return sse([
                chunk(
                    model,
                    {
                        role: 'assistant',
                        reasoning_details: [SIGNED_EMPTY_THINKING, REDACTED_THINKING],
                    },
                    null
                ),
                chunk(
                    model,
                    { tool_calls: toolCallIds.map((id, index) => toolCallDelta(index, id)) },
                    null
                ),
                chunk(model, {}, 'tool_calls'),
            ]);
        }
        return sse([
            chunk(model, { role: 'assistant', content: 'done' }, null),
            chunk(model, {}, 'stop'),
        ]);
    };
    return { requests, fetchImpl };
}

describe('gateway thinking round-trip in a tool loop', () => {
    let logger: Logger;
    let stores: DextoStores;
    let mcpManager: MCPManager;

    beforeEach(async () => {
        logger = createLogger({
            config: { level: 'error', transports: [{ type: 'console', colorize: false }] },
            agentId: 'test-agent',
        });
        stores = new InMemoryDextoStores();
        await stores.connect();
    });

    afterEach(async () => {
        await stores.disconnect();
        logger.destroy();
    });

    async function runToolLoop(provider: LLMProvider, model: string, toolCallIds: string[]) {
        const sessionId = 'thinking-session';
        const agentEventBus = new AgentEventBus();
        const sessionEventBus = new SessionEventBus();
        mcpManager = new MCPManager(logger, agentEventBus);
        const resourceManager = new ResourceManager(
            mcpManager,
            { resourcesConfig: [], artifactStore: stores.getStore('artifacts') },
            agentEventBus,
            logger
        );
        await resourceManager.initialize();

        const systemPromptManager = new SystemPromptManager(
            SystemPromptConfigSchema.parse('You are a helpful assistant.'),
            new MemoryManager(stores.getStore('memories'), logger),
            undefined,
            logger
        );
        const llmConfig = {
            provider,
            model,
            apiKey: 'test-api-key',
            maxInputTokens: 100_000,
            maxOutputTokens: 4096,
            maxIterations: 10,
        } as unknown as ValidatedLLMConfig;
        const contextManager = new ContextManager<ModelMessage>(
            llmConfig,
            new VercelMessageFormatter(logger),
            systemPromptManager,
            100_000,
            stores.getStore('conversation'),
            sessionId,
            resourceManager,
            logger,
            new InMemoryToolOutputStore()
        );

        const approvalManager = new ApprovalManager(
            {
                permissions: { mode: 'auto-approve', timeout: 120000 },
                elicitation: { enabled: false, timeout: 120000 },
            },
            logger,
            createInMemorySessionApprovalStore(logger)
        );
        const toolManager = new ToolManager(
            mcpManager,
            approvalManager,
            {
                isToolAllowed: async () => false,
                allowTool: async () => {},
                disallowTool: async () => {},
            },
            'auto-approve',
            agentEventBus,
            { alwaysAllow: [] },
            [],
            logger,
            createInMemorySessionToolPreferencesStore(logger),
            stores.getStore('toolExecutions')
        );
        await toolManager.initialize();
        toolManager.setToolExecutionContextFactory((baseContext) => baseContext);
        toolManager.addTools([
            defineTool({
                id: 'lookup',
                description: 'Looks something up',
                inputSchema: z.object({}).strict(),
                execute: async () => ({ value: 'found' }),
            }),
        ]);

        const gateway = createFakeGateway(model, toolCallIds);
        const languageModel: LanguageModel = createOpenRouter({
            apiKey: 'test-api-key',
            baseURL: 'https://gateway.test/api/v1',
            fetch: gateway.fetchImpl,
        }).chat(model);

        const llmContext: LLMContext = { provider, model };
        const executor = new TurnExecutor(
            languageModel,
            toolManager,
            contextManager,
            sessionEventBus,
            resourceManager,
            sessionId,
            { maxSteps: 5, maxOutputTokens: 4096 },
            llmContext,
            logger,
            new MessageQueueService(
                sessionEventBus,
                logger,
                sessionId,
                createInMemoryMessageQueueStore()
            ),
            new MessageQueueService(
                sessionEventBus,
                logger,
                sessionId,
                createInMemoryMessageQueueStore(),
                'follow-up'
            )
        );

        await contextManager.addUserMessage([{ type: 'text', text: 'Look it up' }]);
        await executor.execute({ mcpManager }, true);
        return gateway.requests;
    }

    function toolCallingAssistantMessage(requests: ChatRequestBody[]) {
        expect(requests).toHaveLength(2);
        const assistant = requests[1]!.messages.find(
            (message) => message.role === 'assistant' && message.tool_calls
        );
        expect(assistant).toBeDefined();
        return assistant!;
    }

    it.each(['dexto-nova', 'openrouter'] as const)(
        'sends the tool-calling turn thinking blocks back unchanged for Claude on %s',
        async (provider) => {
            const requests = await runToolLoop(provider, 'anthropic/claude-opus-4.5', ['call-1']);

            expect(toolCallingAssistantMessage(requests).reasoning_details).toEqual([
                SIGNED_EMPTY_THINKING,
                REDACTED_THINKING,
            ]);
        }
    );

    it('sends the thinking blocks once when Claude calls several tools in one turn', async () => {
        const requests = await runToolLoop('dexto-nova', 'anthropic/claude-opus-4.5', [
            'call-1',
            'call-2',
        ]);

        const assistant = toolCallingAssistantMessage(requests);
        expect(assistant.tool_calls).toHaveLength(2);
        expect(assistant.reasoning_details).toEqual([SIGNED_EMPTY_THINKING, REDACTED_THINKING]);
    });

    it('sends no reasoning details back for a non-Anthropic model', async () => {
        const requests = await runToolLoop('dexto-nova', 'openai/gpt-5', ['call-1']);

        expect(toolCallingAssistantMessage(requests).reasoning_details).toBeUndefined();
    });
});
