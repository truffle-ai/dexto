import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { QueuedMessage, StreamingEvent } from '@dexto/core';
import type { Message, UIState, SessionState } from '../state/types.js';
import { processStream } from './processStream.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

type SetStateAction<T> = React.SetStateAction<T>;
type Dispatch<T> = React.Dispatch<SetStateAction<T>>;

function isStateUpdater<T>(action: SetStateAction<T>): action is (prev: T) => T {
    return typeof action === 'function';
}

function createState<T>(initial: T): { get: () => T; set: Dispatch<T> } {
    let state = initial;
    return {
        get: () => state,
        set: (action: SetStateAction<T>) => {
            state = isStateUpdater(action) ? action(state) : action;
        },
    };
}

async function* eventStream(events: StreamingEvent[]) {
    for (const event of events) {
        yield event;
    }
}

function createSetters() {
    const messages = createState<Message[]>([]);
    const pendingMessages = createState<Message[]>([]);
    const dequeuedBuffer = createState<Message[]>([]);
    const ui = createState<UIState>({
        isProcessing: false,
        isCancelling: false,
        isThinking: false,
        isCompacting: false,
        activeOverlay: 'none',
        showReasoning: true,
        exitWarningShown: false,
        exitWarningTimestamp: null,
        mcpWizardServerType: null,
        copyModeEnabled: false,
        pendingModelSwitch: null,
        selectedMcpServer: null,
        historySearch: {
            isActive: false,
            query: '',
            matchIndex: 0,
            originalInput: '',
            lastMatch: '',
        },
        promptAddWizard: null,
        autoApproveEdits: false,
        todoExpanded: true,
        backgroundTasksRunning: 0,
        backgroundTasksExpanded: false,
        backgroundTasks: [],
        planModeActive: false,
        planModeInitialized: false,
        commandOutput: null,
        bypassPermissions: false,
    });
    const session = createState<SessionState>({
        id: 'test-session',
        hasActiveSession: true,
        modelName: 'test-model',
    });

    const createNoopDispatch =
        <T>(): React.Dispatch<React.SetStateAction<T>> =>
        () =>
            undefined;

    return {
        getMessages: messages.get,
        getPendingMessages: pendingMessages.get,
        getUi: ui.get,
        setters: {
            setMessages: messages.set,
            setPendingMessages: pendingMessages.set,
            setDequeuedBuffer: dequeuedBuffer.set,
            setUi: ui.set,
            setSession: session.set,
            setQueuedMessages: createNoopDispatch<QueuedMessage[]>(),
            setApproval: createNoopDispatch<ApprovalRequest | null>(),
            setApprovalQueue: createNoopDispatch<ApprovalRequest[]>(),
        },
    };
}

describe('processStream (reasoning)', () => {
    it('attaches streamed reasoning chunks to the assistant message', async () => {
        const { getMessages, getPendingMessages, setters } = createSetters();

        const events: StreamingEvent[] = [
            { name: 'llm:thinking', sessionId: 'test-session' },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'reasoning',
                content: 'R1',
            },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'reasoning',
                content: 'R2',
            },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'text',
                content: 'Hello',
            },
            {
                name: 'llm:response',
                sessionId: 'test-session',
                content: 'Hello',
            },
            {
                name: 'run:complete',
                sessionId: 'test-session',
                finishReason: 'stop',
                stepCount: 1,
                durationMs: 1,
            },
        ];

        const iterator = eventStream(events);

        await processStream(iterator, setters, {
            useStreaming: true,
            autoApproveEditsRef: { current: false },
            bypassPermissionsRef: { current: false },
            eventBus: { emit: vi.fn() },
        });

        expect(getPendingMessages()).toEqual([]);

        const assistantMessages = getMessages().filter((m) => m.role === 'assistant');
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.content).toBe('Hello');
        expect(assistantMessages[0]?.reasoning).toBe('R1R2');
    });

    it('does not duplicate reasoning when progressive splitting occurs', async () => {
        const { getMessages, setters } = createSetters();

        const longText = 'A'.repeat(120) + '\n\n' + 'B'.repeat(120) + '\n\n' + 'C'.repeat(120);

        const events: StreamingEvent[] = [
            { name: 'llm:thinking', sessionId: 'test-session' },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'reasoning',
                content: 'R',
            },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'text',
                content: longText,
            },
            {
                name: 'llm:response',
                sessionId: 'test-session',
                content: longText,
            },
            {
                name: 'run:complete',
                sessionId: 'test-session',
                finishReason: 'stop',
                stepCount: 1,
                durationMs: 1,
            },
        ];

        const iterator = eventStream(events);

        await processStream(iterator, setters, {
            useStreaming: true,
            autoApproveEditsRef: { current: false },
            bypassPermissionsRef: { current: false },
            eventBus: { emit: vi.fn() },
        });

        const assistantMessages = getMessages().filter((m) => m.role === 'assistant');

        // We should get at least 2 messages due to progressive splitting.
        expect(assistantMessages.length).toBeGreaterThanOrEqual(2);

        const messagesWithReasoning = assistantMessages.filter((m) => m.reasoning);
        expect(messagesWithReasoning).toHaveLength(1);
        expect(messagesWithReasoning[0]?.reasoning).toBe('R');
    });

    it('includes reasoning in non-streaming mode (accumulated from chunks)', async () => {
        const { getMessages, setters } = createSetters();

        const events: StreamingEvent[] = [
            { name: 'llm:thinking', sessionId: 'test-session' },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'reasoning',
                content: 'R',
            },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'text',
                content: 'Hello',
            },
            {
                name: 'llm:response',
                sessionId: 'test-session',
                content: 'Hello',
            },
            {
                name: 'run:complete',
                sessionId: 'test-session',
                finishReason: 'stop',
                stepCount: 1,
                durationMs: 1,
            },
        ];

        const iterator = eventStream(events);

        await processStream(iterator, setters, {
            useStreaming: false,
            autoApproveEditsRef: { current: false },
            bypassPermissionsRef: { current: false },
            eventBus: { emit: vi.fn() },
        });

        const assistantMessages = getMessages().filter((m) => m.role === 'assistant');
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.content).toBe('Hello');
        expect(assistantMessages[0]?.reasoning).toBe('R');
    });

    it('does not duplicate reasoning in non-streaming mode when reasoning is emitted before a tool call', async () => {
        const { getMessages, setters } = createSetters();

        const events: StreamingEvent[] = [
            { name: 'llm:thinking', sessionId: 'test-session' },
            {
                name: 'llm:chunk',
                sessionId: 'test-session',
                chunkType: 'reasoning',
                content: 'R',
            },
            {
                name: 'llm:tool-call',
                sessionId: 'test-session',
                toolName: 'test-tool',
                args: {},
            },
            {
                name: 'llm:response',
                sessionId: 'test-session',
                content: 'Final',
                reasoning: 'R',
            },
            {
                name: 'run:complete',
                sessionId: 'test-session',
                finishReason: 'stop',
                stepCount: 1,
                durationMs: 1,
            },
        ];

        const iterator = eventStream(events);

        await processStream(iterator, setters, {
            useStreaming: false,
            autoApproveEditsRef: { current: false },
            bypassPermissionsRef: { current: false },
            eventBus: { emit: vi.fn() },
        });

        const assistantMessages = getMessages().filter((m) => m.role === 'assistant');
        expect(assistantMessages).toHaveLength(2);

        expect(assistantMessages[0]?.content).toBe('');
        expect(assistantMessages[0]?.reasoning).toBe('R');

        expect(assistantMessages[1]?.content).toBe('Final');
        expect(assistantMessages[1]?.reasoning).toBeUndefined();
    });
});
