/**
 * Measures one turn step over a large stored history: how many times the step reads the
 * conversation store, and the peak heap while it runs.
 *
 *   pnpm exec turbo run build --filter=@dexto/core^...   # once: builds @dexto/llm
 *   node --expose-gc --import tsx packages/core/scripts/step-history-memory.ts <plain|prune|stream>
 *
 * `plain` seeds about 230 user and assistant messages of about 14 MB, so the step neither
 * prunes nor compacts. `prune` seeds the same size as tool results, so the step prunes old
 * ones and must reload. `stream` seeds the `plain` history and streams a reply of 200 text
 * deltas and 2 tool calls, so it counts the reads that persisting a streamed reply costs.
 * The model is an in-process mock; the store is the in-memory store, which clones the history
 * on every read like a store that parses it.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { simulateReadableStream, type LanguageModel } from 'ai';
import { createLogger } from '../src/logger/factory.js';
import { TurnExecutor } from '../src/llm/executor/turn-executor.js';
import { ContextManager } from '../src/context/manager.js';
import { ToolManager } from '../src/tools/tool-manager.js';
import { SessionEventBus, AgentEventBus } from '../src/events/index.js';
import { ResourceManager } from '../src/resources/index.js';
import { MessageQueueService } from '../src/session/message-queue.js';
import { SystemPromptManager } from '../src/systemPrompt/manager.js';
import { SystemPromptConfigSchema } from '../src/systemPrompt/schemas.js';
import { VercelMessageFormatter } from '../src/llm/formatters/vercel.js';
import { MCPManager } from '../src/mcp/manager.js';
import { ApprovalManager } from '../src/approval/manager.js';
import { MemoryManager } from '../src/memory/index.js';
import { InMemoryDextoStores, InMemoryToolOutputStore } from '../src/storage/stores/in-memory.js';
import {
    createInMemoryMessageQueueStore,
    createInMemorySessionApprovalStore,
    createInMemorySessionToolPreferencesStore,
} from '../src/test-utils/session-state-stores.js';
import type { ValidatedLLMConfig } from '../src/llm/schemas.js';
import { z } from 'zod';
import { defineTool } from '../src/tools/define-tool.js';
import type { InternalMessage } from '../src/context/types.js';

const scenario = process.argv[2];
if (scenario !== 'plain' && scenario !== 'prune' && scenario !== 'stream') {
    throw new Error('usage: step-history-memory.ts <plain|prune|stream>');
}

const STREAM_TEXT_DELTAS = 200;

const sessionId = 'heap-session';
const MESSAGE_BYTES = 120_000;
const MESSAGE_COUNT = 230;

function seedMessages(): InternalMessage[] {
    const messages: InternalMessage[] = [];
    const text = 'x'.repeat(MESSAGE_BYTES);
    if (scenario !== 'prune') {
        for (let i = 0; messages.length < MESSAGE_COUNT; i++) {
            messages.push({
                id: `u-${i}`,
                role: 'user',
                content: [{ type: 'text', text: `question ${i}` }],
            });
            messages.push({
                id: `a-${i}`,
                role: 'assistant',
                content: [{ type: 'text', text: `${i}:${text}` }],
                assistantOutput: { status: 'complete' },
            });
        }
        return messages;
    }
    for (let i = 0; messages.length < MESSAGE_COUNT; i++) {
        messages.push({
            id: `u-${i}`,
            role: 'user',
            content: [{ type: 'text', text: `question ${i}` }],
        });
        messages.push({
            id: `a-${i}`,
            role: 'assistant',
            content: null,
            assistantOutput: { status: 'complete' },
            toolCalls: [
                { id: `call-${i}`, type: 'function', function: { name: 'read', arguments: '{}' } },
            ],
        });
        messages.push({
            id: `t-${i}`,
            role: 'tool',
            toolCallId: `call-${i}`,
            name: 'read',
            content: [{ type: 'text', text: `${i}:${text}` }],
        });
    }
    return messages;
}

const logger = createLogger({
    config: { level: 'error', transports: [{ type: 'console', colorize: false }] },
    agentId: 'heap-harness',
});
const agentEventBus = new AgentEventBus();
const sessionEventBus = new SessionEventBus();
const stores = new InMemoryDextoStores();
await stores.connect();
const toolOutputStore = new InMemoryToolOutputStore();
const mcpManager = new MCPManager(logger, agentEventBus);
const resourceManager = new ResourceManager(
    mcpManager,
    { resourcesConfig: [], artifactStore: stores.getStore('artifacts') },
    agentEventBus,
    logger
);
await resourceManager.initialize();
const conversationStore = stores.getStore('conversation');

const maxInputTokens = 100_000;
const contextManager = new ContextManager(
    {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: 'unused',
        maxInputTokens,
        maxOutputTokens: 4096,
        temperature: 0.7,
        maxIterations: 10,
    } as unknown as ValidatedLLMConfig,
    new VercelMessageFormatter(logger),
    new SystemPromptManager(
        SystemPromptConfigSchema.parse('You are a helpful assistant.'),
        new MemoryManager(stores.getStore('memories'), logger),
        undefined,
        logger
    ),
    maxInputTokens,
    conversationStore,
    sessionId,
    resourceManager,
    logger,
    toolOutputStore
);

const approvalManager = new ApprovalManager(
    {
        permissions: { mode: 'full-access', timeout: 120000 },
        elicitation: { enabled: false, timeout: 120000 },
    },
    logger,
    createInMemorySessionApprovalStore(logger)
);
const toolManager = new ToolManager(
    mcpManager,
    approvalManager,
    { isToolAllowed: async () => false, allowTool: () => {}, disallowTool: () => {} },
    'full-access',
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
        id: 'step_tool',
        description: 'Returns a short string',
        inputSchema: z.object({ value: z.string() }).strict(),
        execute: async () => 'done',
    }),
]);

const model = {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: async () => {
        throw new Error('the step streams');
    },
    doStream: async () => ({
        stream: simulateReadableStream({
            chunks:
                scenario === 'stream'
                    ? [
                          { type: 'stream-start', warnings: [] },
                          { type: 'text-start', id: '1' },
                          ...Array.from({ length: STREAM_TEXT_DELTAS }, () => ({
                              type: 'text-delta' as const,
                              id: '1',
                              delta: 'streamed words ',
                          })),
                          { type: 'text-end', id: '1' },
                          ...[1, 2].map((n) => ({
                              type: 'tool-call' as const,
                              toolCallId: `stream-call-${n}`,
                              toolName: 'step_tool',
                              input: JSON.stringify({ value: String(n) }),
                          })),
                          {
                              type: 'finish',
                              finishReason: 'tool-calls',
                              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
                          },
                      ]
                    : [
                          { type: 'stream-start', warnings: [] },
                          { type: 'text-start', id: '1' },
                          { type: 'text-delta', id: '1', delta: 'ok' },
                          { type: 'text-end', id: '1' },
                          {
                              type: 'finish',
                              finishReason: 'stop',
                              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
                          },
                      ],
        }),
    }),
} as unknown as LanguageModel;

const executor = new TurnExecutor(
    model,
    toolManager,
    contextManager,
    sessionEventBus,
    resourceManager,
    sessionId,
    { maxSteps: 1, maxOutputTokens: 4096, temperature: 0.7 },
    { provider: 'openai', model: 'gpt-4' },
    logger,
    new MessageQueueService(sessionEventBus, logger, sessionId, createInMemoryMessageQueueStore()),
    new MessageQueueService(
        sessionEventBus,
        logger,
        sessionId,
        createInMemoryMessageQueueStore(),
        'follow-up'
    )
);

for (const message of seedMessages()) {
    await conversationStore.saveMessage({ sessionId, message });
}
await contextManager.addUserMessage([{ type: 'text', text: 'one more question' }]);
// What one full read of the stored history parses, for the parsed-bytes total.
const historyBytes = JSON.stringify(await conversationStore.listMessages({ sessionId })).length;

// Count store reads, and sample the heap whenever the step touches the store.
let peakHeap = 0;
const sampleHeap = () => {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
};
const reads = {
    loadModelHistory: 0,
    countModelMessages: 0,
    listMessages: 0,
    updateMessage: 0,
    getMessage: 0,
    patchMessage: 0,
};
for (const name of Object.keys(reads) as (keyof typeof reads)[]) {
    const original = (conversationStore as Record<string, unknown>)[name];
    if (typeof original !== 'function') continue;
    (conversationStore as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        reads[name] += 1;
        sampleHeap();
        const result = await original.apply(conversationStore, args);
        sampleHeap();
        return result;
    };
}
let gcEvents = 0;
const gcObserver = new PerformanceObserver((list) => {
    gcEvents += list.getEntries().length;
    sampleHeap();
});
gcObserver.observe({ entryTypes: ['gc'] });

const gc = globalThis.gc;
if (!gc) throw new Error('run with --expose-gc');
gc();
await sleep(50);
gc();
const baselineHeap = process.memoryUsage().heapUsed;
peakHeap = baselineHeap;
const timer = setInterval(sampleHeap, 1);

const started = performance.now();
await executor.execute({ mcpManager }, true);
const elapsedMs = performance.now() - started;
sampleHeap();
clearInterval(timer);
gcObserver.disconnect();
const stepReads = { ...reads };

const mb = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(1));
const seeded = (await conversationStore.listMessages({ sessionId })).length;
console.log(
    JSON.stringify({
        scenario,
        storedMessages: seeded,
        storeReads: stepReads,
        parsedMbPerFullRead: mb(historyBytes),
        parsedMbByFullReads: mb(
            (stepReads.listMessages + stepReads.loadModelHistory) * historyBytes
        ),
        baselineHeapMb: mb(baselineHeap),
        peakHeapMb: mb(peakHeap),
        peakAboveBaselineMb: mb(peakHeap - baselineHeap),
        gcEventsDuringStep: gcEvents,
        stepMs: Math.round(elapsedMs),
    })
);
process.exit(0);
