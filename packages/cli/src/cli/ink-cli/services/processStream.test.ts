import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { AgentEventBus, QueuedMessage, StreamingEvent } from '@dexto/core';
import type { Message, UIState, SessionState } from '../state/types.js';
import { processStream } from './processStream.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

type SetStateAction<T> = T | ((prev: T) => T);
type Dispatch<T> = (value: SetStateAction<T>) => void;

function createState<T>(initial: T): { get: () => T; set: Dispatch<T> } {
    let state = initial;
    return {
        get: () => state,
        set: (action: SetStateAction<T>) => {
            state = typeof action === 'function' ? (action as (p: T) => T)(state) : action;
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
        planModeActive: false,
        planModeInitialized: false,
    });
    const session = createState<SessionState>({
        id: 'test-session',
        hasActiveSession: true,
        modelName: 'test-model',
    });

    const setMessages = messages.set as unknown as React.Dispatch<React.SetStateAction<Message[]>>;
    const setPendingMessages = pendingMessages.set as unknown as React.Dispatch<
        React.SetStateAction<Message[]>
    >;
    const setDequeuedBuffer = dequeuedBuffer.set as unknown as React.Dispatch<
        React.SetStateAction<Message[]>
    >;
    const setUi = ui.set as unknown as React.Dispatch<React.SetStateAction<UIState>>;
    const setSession = session.set as unknown as React.Dispatch<React.SetStateAction<SessionState>>;

    const noopDispatch = ((_: unknown) => {}) as unknown;

    return {
        getMessages: messages.get,
        getPendingMessages: pendingMessages.get,
        getUi: ui.get,
        setters: {
            setMessages,
            setPendingMessages,
            setDequeuedBuffer,
            setUi,
            setSession,
            setQueuedMessages: noopDispatch as React.Dispatch<
                React.SetStateAction<QueuedMessage[]>
            >,
            setApproval: noopDispatch as React.Dispatch<
                React.SetStateAction<ApprovalRequest | null>
            >,
            setApprovalQueue: noopDispatch as React.Dispatch<
                React.SetStateAction<ApprovalRequest[]>
            >,
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
            eventBus: { emit: vi.fn() } as unknown as AgentEventBus,
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
            eventBus: { emit: vi.fn() } as unknown as AgentEventBus,
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
            eventBus: { emit: vi.fn() } as unknown as AgentEventBus,
        });

        const assistantMessages = getMessages().filter((m) => m.role === 'assistant');
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.content).toBe('Hello');
        expect(assistantMessages[0]?.reasoning).toBe('R');
    });
});
