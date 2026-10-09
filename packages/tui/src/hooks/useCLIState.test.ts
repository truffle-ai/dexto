import { createElement, createRef, Fragment } from 'react';
import { PassThrough } from 'node:stream';
import { render, Static, Text } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { useCLIState, type CLIStateReturn } from './useCLIState.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import type { TuiAgentBackend } from '../agent-backend.js';
import { AgentEventBus, type InternalMessage, type QueuedMessage } from '@dexto/core';
import { createUserMessage } from '../utils/messageFormatting.js';
import type { Message } from '../state/types.js';
import { InputContainer, type InputContainerHandle } from '../containers/InputContainer.js';

vi.mock('../components/input/InputArea.js', () => ({ InputArea: () => null }));

const agent = {
    getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-5' }),
    getSessionHistory: async () => [],
    on: () => {},
} as unknown as TuiAgentBackend;

function mountState(
    initialSessionId: string | null,
    backend: TuiAgentBackend = agent,
    initialPrompt?: string,
    withInput = false
) {
    const inputRef = createRef<InputContainerHandle>();
    const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false });
    let state: CLIStateReturn | undefined;
    let output = '';
    stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
    });
    function Probe() {
        state = useCLIState({
            agent: backend,
            initialSessionId,
            initialBypassPermissions: true,
            startupInfo: {
                connectedServers: { count: 0, names: [] },
                failedConnections: [],
                toolCount: 0,
                logFile: null,
            },
        });
        const transcript = createElement(Static<Message>, {
            items: state.visibleMessages,
            children: (message) => createElement(Text, { key: message.id }, message.content),
        });
        return createElement(
            Fragment,
            null,
            transcript,
            withInput
                ? createElement(InputContainer, {
                      ...state,
                      ref: inputRef,
                      initialPrompt,
                      configFilePath: null,
                  })
                : null
        );
    }
    const view = render(createElement(KeypressProvider, null, createElement(Probe)), {
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
        exitOnCtrlC: false,
    });
    return {
        getState() {
            if (!state) throw new Error('Not mounted');
            return state;
        },
        submit(text: string) {
            if (!inputRef.current) throw new Error('Input not mounted');
            return inputRef.current.submit(text);
        },
        output() {
            return output;
        },
        close() {
            view.unmount();
            view.cleanup();
        },
    };
}

describe('TUI session permission modes', () => {
    it('keeps startup auto-approval when the first session is created, then resets on switch', async () => {
        const screen = mountState(null);
        try {
            await vi.waitFor(() => expect(screen.getState().ui.bypassPermissions).toBe(true));
            screen
                .getState()
                .setSession((previous) => ({ ...previous, id: 'a', hasActiveSession: true }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            expect(screen.getState().ui.bypassPermissions).toBe(true);
            screen
                .getState()
                .setSession((previous) => ({ ...previous, id: 'b', hasActiveSession: true }));
            await vi.waitFor(() => expect(screen.getState().ui.bypassPermissions).toBe(false));
        } finally {
            screen.close();
        }
    });

    it('resets accept-edits mode when a conversation is cleared', async () => {
        const screen = mountState('a');
        try {
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            screen.getState().setUi((previous) => ({
                ...previous,
                autoApproveEdits: true,
                bypassPermissions: false,
            }));
            await vi.waitFor(() => expect(screen.getState().ui.autoApproveEdits).toBe(true));
            screen
                .getState()
                .setSession((previous) => ({ ...previous, id: null, hasActiveSession: false }));
            await vi.waitFor(() => expect(screen.getState().ui.autoApproveEdits).toBe(false));
        } finally {
            screen.close();
        }
    });
});

describe('TUI resumed history', () => {
    it('waits for the actual history snapshot before persisting the startup prompt', async () => {
        let releaseHistory: () => void = () => {};
        const ready = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        const persisted: InternalMessage[] = [
            { role: 'user', content: [{ type: 'text', text: 'earlier task' }] },
        ];
        const stream = vi.fn(async function* (content: string) {
            persisted.push({ role: 'user', content: [{ type: 'text', text: content }] });
            yield { name: 'run:complete', sessionId: 'a', durationMs: 0, totalTokens: 0 };
        });
        const backend = {
            ...agent,
            stream,
            getSessionMetadata: async () => ({ messageCount: 1 }),
            logger: { error: vi.fn() },
            getSessionHistory: vi.fn(async () => {
                await ready;
                return [...persisted];
            }),
        } as unknown as TuiAgentBackend;
        const screen = mountState('a', backend, 'startup task', true);
        try {
            await vi.waitFor(() => expect(backend.getSessionHistory).toHaveBeenCalled());
            expect(stream).not.toHaveBeenCalled();
            screen.getState().buffer.setText('new draft');
            await vi.waitFor(() => expect(screen.getState().input.value).toBe('new draft'));
            releaseHistory();
            await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
            expect(screen.getState().messages.map((message) => message.content)).toEqual([
                'earlier task',
                'startup task',
            ]);
            expect(screen.getState().input.value).toBe('new draft');
            expect(screen.output().match(/startup task/g)).toHaveLength(1);
        } finally {
            releaseHistory();
            screen.close();
        }
    });

    it('cancels the startup prompt after switching away from its pending resumed session', async () => {
        let releaseHistory: () => void = () => {};
        const ready = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        const stream = vi.fn(async function* (_content: string) {
            yield { name: 'run:complete', sessionId: 'b', durationMs: 0, totalTokens: 0 };
        });
        const backend = {
            ...agent,
            stream,
            getSessionMetadata: async () => ({ messageCount: 1 }),
            logger: { error: vi.fn() },
            getSessionHistory: vi.fn(async () => {
                await ready;
                return [];
            }),
        } as unknown as TuiAgentBackend;
        const screen = mountState('a', backend, 'startup task for a', true);
        try {
            await vi.waitFor(() => expect(backend.getSessionHistory).toHaveBeenCalledWith('a'));
            screen.getState().setSession((previous) => ({ ...previous, id: 'b' }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('b'));
            expect(stream).not.toHaveBeenCalled();
            await screen.submit('manual task for b');
            expect(stream).toHaveBeenCalledExactlyOnceWith('manual task for b', 'b');
            releaseHistory();
            screen.getState().setUi((previous) => ({ ...previous, isThinking: true }));
            await vi.waitFor(() => expect(screen.getState().ui.isThinking).toBe(true));
            expect(stream).toHaveBeenCalledTimes(1);
            expect(screen.getState().messages.map((message) => message.content)).toEqual([
                'manual task for b',
            ]);
        } finally {
            releaseHistory();
            screen.close();
        }
    });

    it('still creates a first session for an ordinary startup prompt', async () => {
        const createSession = vi.fn(async () => ({ id: 'created' }));
        const stream = vi.fn(async function* (_content: string) {
            yield { name: 'run:complete', sessionId: 'created', durationMs: 0, totalTokens: 0 };
        });
        const backend = {
            ...agent,
            createSession,
            stream,
            getSessionMetadata: async () => ({ messageCount: 1 }),
            logger: { error: vi.fn() },
        } as unknown as TuiAgentBackend;
        const screen = mountState(null, backend, 'new startup task', true);
        try {
            await vi.waitFor(() =>
                expect(stream).toHaveBeenCalledExactlyOnceWith('new startup task', 'created')
            );
            expect(createSession).toHaveBeenCalledTimes(1);
            expect(screen.getState().session.id).toBe('created');
        } finally {
            screen.close();
        }
    });

    it('preserves multiple submissions and a newer draft while resumed history is pending', async () => {
        let releaseHistory: () => void = () => {};
        const ready = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        const stream = vi.fn(async function* (_content: string) {
            yield { name: 'run:complete', sessionId: 'a', durationMs: 0, totalTokens: 0 };
        });
        const backend = {
            ...agent,
            stream,
            getSessionMetadata: async () => ({ messageCount: 1 }),
            logger: { error: vi.fn() },
            getSessionHistory: vi.fn(async () => {
                await ready;
                return [{ role: 'user', content: [{ type: 'text', text: 'earlier task' }] }];
            }),
        } as unknown as TuiAgentBackend;
        const screen = mountState('a', backend, 'startup task', true);
        try {
            await vi.waitFor(() => expect(backend.getSessionHistory).toHaveBeenCalled());
            const first = screen.submit('first task');
            const second = screen.submit('second task');
            const repeated = screen.submit('first task');
            screen.getState().buffer.setText('newer draft');
            await vi.waitFor(() => expect(screen.getState().input.value).toBe('newer draft'));
            expect(stream).not.toHaveBeenCalled();
            releaseHistory();
            await Promise.all([first, second, repeated]);
            await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(4));
            expect(stream.mock.calls.map(([content]) => content)).toEqual([
                'startup task',
                'first task',
                'second task',
                'first task',
            ]);
            expect(screen.getState().input.history).toEqual([
                'earlier task',
                'startup task',
                'first task',
                'second task',
                'first task',
            ]);
            expect(screen.getState().input.value).toBe('newer draft');
        } finally {
            releaseHistory();
            screen.close();
        }
    });

    it('releases deferred submission after history failure without hydrating again on return', async () => {
        let releaseHistory: () => void = () => {};
        const ready = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        const stream = vi.fn(async function* (_content: string) {
            yield { name: 'run:complete', sessionId: 'a', durationMs: 0, totalTokens: 0 };
        });
        const backend = {
            ...agent,
            stream,
            getSessionMetadata: async () => ({ messageCount: 1 }),
            logger: { error: vi.fn() },
            getSessionHistory: vi.fn(async () => {
                await ready;
                throw new Error('history unavailable');
            }),
        } as unknown as TuiAgentBackend;
        const screen = mountState('a', backend, undefined, true);
        try {
            await vi.waitFor(() => expect(backend.getSessionHistory).toHaveBeenCalled());
            const pending = screen.submit('continue anyway');
            expect(stream).not.toHaveBeenCalled();
            releaseHistory();
            await pending;
            await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
            expect(screen.getState().messages.map((message) => message.content)).toEqual([
                'Error: history unavailable',
                'continue anyway',
            ]);
            screen.getState().setSession((previous) => ({ ...previous, id: 'b' }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('b'));
            screen.getState().setSession((previous) => ({ ...previous, id: 'a' }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            expect(backend.getSessionHistory).toHaveBeenCalledTimes(1);
        } finally {
            releaseHistory();
            screen.close();
        }
    });

    it('does not send deferred submissions into a different session', async () => {
        let releaseHistory: () => void = () => {};
        const ready = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        const stream = vi.fn();
        const backend = {
            ...agent,
            stream,
            getSessionHistory: vi.fn(async () => {
                await ready;
                return [];
            }),
        } as unknown as TuiAgentBackend;
        const screen = mountState('a', backend, undefined, true);
        try {
            await vi.waitFor(() => expect(backend.getSessionHistory).toHaveBeenCalled());
            const pending = screen.submit('session a task');
            screen.getState().setSession((previous) => ({ ...previous, id: 'b' }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('b'));
            await pending;
            releaseHistory();
            expect(stream).not.toHaveBeenCalled();
            expect(screen.getState().messages).toEqual([]);
        } finally {
            releaseHistory();
            screen.close();
        }
    });

    it('preserves resumed history and a prompt submitted while history is loading', async () => {
        let finishHistory: (history: InternalMessage[]) => void = () => {
            throw new Error('History request not started');
        };
        const history = new Promise<InternalMessage[]>((resolve) => {
            finishHistory = resolve;
        });
        const getSessionHistory = vi.fn(() => history);
        const screen = mountState('a', { ...agent, getSessionHistory });
        try {
            await vi.waitFor(() => expect(getSessionHistory).toHaveBeenCalledWith('a'));
            const prompt = createUserMessage('continue this task');
            screen.getState().setMessages((previous) => [...previous, prompt]);
            screen.getState().setInput((previous) => ({
                ...previous,
                history: [...previous.history, prompt.content],
            }));
            await vi.waitFor(() => expect(screen.getState().messages).toEqual([prompt]));
            expect(screen.output()).not.toContain('continue this task');
            finishHistory([
                { role: 'user', content: [{ type: 'text', text: 'earlier task' }] },
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'earlier answer' }],
                },
            ]);
            await vi.waitFor(() =>
                expect(screen.getState().messages.map((message) => message.content)).toEqual([
                    'earlier task',
                    'earlier answer',
                    'continue this task',
                ])
            );
            expect(screen.getState().input.history).toEqual(['earlier task', 'continue this task']);
            await vi.waitFor(() => expect(screen.output()).toContain('continue this task'));
            expect(screen.output().indexOf('earlier task')).toBeLessThan(
                screen.output().indexOf('continue this task')
            );
            expect(screen.output().indexOf('earlier answer')).toBeLessThan(
                screen.output().indexOf('continue this task')
            );
            expect(screen.output().match(/continue this task/g)).toHaveLength(1);
            expect(getSessionHistory).toHaveBeenCalledTimes(1);
        } finally {
            screen.close();
        }
    });
    it('discards pending resumed history after switching to another session', async () => {
        let finishHistory: (history: InternalMessage[]) => void = () => {
            throw new Error('History request not started');
        };
        const history = new Promise<InternalMessage[]>((resolve) => {
            finishHistory = resolve;
        });
        const getSessionHistory = vi.fn(() => history);
        const screen = mountState('a', { ...agent, getSessionHistory });
        try {
            await vi.waitFor(() => expect(getSessionHistory).toHaveBeenCalledWith('a'));
            screen.getState().setSession((previous) => ({
                ...previous,
                id: 'b',
                hasActiveSession: true,
            }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('b'));
            const prompt = createUserMessage('session b prompt');
            screen.getState().setMessages([prompt]);
            screen.getState().setInput((previous) => ({ ...previous, history: [prompt.content] }));
            await vi.waitFor(() => expect(screen.output()).toContain('session b prompt'));
            finishHistory([
                { role: 'user', content: [{ type: 'text', text: 'session a history' }] },
            ]);
            await history;
            // Wait for a render after the history continuation before checking that it was ignored.
            screen.getState().setUi((previous) => ({ ...previous, isThinking: true }));
            await vi.waitFor(() => expect(screen.getState().ui.isThinking).toBe(true));
            expect(screen.getState().messages).toEqual([prompt]);
            expect(screen.getState().input.history).toEqual(['session b prompt']);
            expect(screen.output()).not.toContain('session a history');
            expect(getSessionHistory).toHaveBeenCalledTimes(1);
        } finally {
            screen.close();
        }
    });

    it('loads ordinary resumed history once without replacing a current input draft', async () => {
        const getSessionHistory = vi.fn(
            async (): Promise<InternalMessage[]> => [
                { role: 'user', content: [{ type: 'text', text: 'earlier task' }] },
                {
                    role: 'assistant',
                    assistantOutput: { status: 'complete' },
                    content: [{ type: 'text', text: 'earlier answer' }],
                },
            ]
        );
        const screen = mountState('a', { ...agent, getSessionHistory });
        try {
            await vi.waitFor(() => expect(screen.getState().messages).toHaveLength(2));
            screen.getState().buffer.setText('next task draft');
            await vi.waitFor(() => expect(screen.getState().input.value).toBe('next task draft'));
            expect(screen.getState().input.history).toEqual(['earlier task']);
            screen.getState().setSession((previous) => ({ ...previous, id: 'b' }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('b'));
            screen.getState().setSession((previous) => ({ ...previous, id: 'a' }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            expect(screen.getState().messages.map((message) => message.content)).toEqual([
                'earlier task',
                'earlier answer',
            ]);
            expect(getSessionHistory).toHaveBeenCalledTimes(1);
        } finally {
            screen.close();
        }
    });
    it('releases submitted messages to static output when resumed history fails', async () => {
        let releaseHistory: () => void = () => {};
        const ready = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        const getSessionHistory = vi.fn(async () => {
            await ready;
            throw new Error('history unavailable');
        });
        const screen = mountState('a', { ...agent, getSessionHistory });
        try {
            await vi.waitFor(() => expect(getSessionHistory).toHaveBeenCalledWith('a'));
            const prompt = createUserMessage('continue without history');
            screen.getState().setMessages([prompt]);
            await vi.waitFor(() => expect(screen.getState().messages).toEqual([prompt]));
            expect(screen.output()).not.toContain(prompt.content);
            releaseHistory();
            await vi.waitFor(() => expect(screen.output()).toContain('Error: history unavailable'));
            expect(screen.output()).toContain(prompt.content);
            expect(screen.output().match(/continue without history/g)).toHaveLength(1);
            expect(screen.getState().messages.map((message) => message.content)).toEqual([
                prompt.content,
                'Error: history unavailable',
            ]);
        } finally {
            screen.close();
        }
    });
});

describe('TUI session queue isolation', () => {
    it('keeps a current-session queue snapshot while the composer changes', async () => {
        const events = new AgentEventBus();
        let release: (messages: QueuedMessage[]) => void = () => {};
        const pending = new Promise<QueuedMessage[]>((resolve) => {
            release = resolve;
        });
        const messages: QueuedMessage[] = [
            { id: 'queued', content: [{ type: 'text', text: 'queued task' }], queuedAt: 1 },
        ];
        const backend = {
            ...agent,
            on: events.on.bind(events),
            getSteerMessages: vi.fn(async () => pending),
        };
        const screen = mountState('a', backend);
        try {
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            events.emit('message:queued', {
                sessionId: 'a',
                queue: 'steer',
                id: 'queued',
                position: 1,
            });
            screen.getState().buffer.setText('a newer draft');
            await vi.waitFor(() => expect(screen.getState().input.value).toBe('a newer draft'));
            release(messages);
            await vi.waitFor(() => expect(screen.getState().steerMessages).toEqual(messages));
            expect(screen.getState().input.value).toBe('a newer draft');
        } finally {
            release([]);
            screen.close();
        }
    });

    it.each(['steer', 'follow-up'] as const)(
        'ignores %s queue events from another session',
        async (queue) => {
            const events = new AgentEventBus();
            const getMessages = vi.fn(async () => []);
            const backend = {
                ...agent,
                on: events.on.bind(events),
                getSteerMessages: getMessages,
                getFollowUpMessages: getMessages,
            };
            const screen = mountState('a', backend);
            try {
                await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
                events.emit('message:queued', { sessionId: 'b', queue, id: 'other', position: 1 });
                events.emit('message:removed', { sessionId: 'b', queue, id: 'other' });
                expect(getMessages).not.toHaveBeenCalled();
            } finally {
                screen.close();
            }
        }
    );

    it.each(['steer', 'follow-up'] as const)(
        'discards a pending %s snapshot after switching sessions',
        async (queue) => {
            const events = new AgentEventBus();
            let release: (messages: QueuedMessage[]) => void = () => {};
            const pending = new Promise<QueuedMessage[]>((resolve) => {
                release = resolve;
            });
            const current: QueuedMessage[] = [
                { id: 'current', content: [{ type: 'text', text: 'current task' }], queuedAt: 1 },
            ];
            const getMessages = vi.fn(async (sessionId: string) =>
                sessionId === 'a' ? pending : current
            );
            const backend = {
                ...agent,
                on: events.on.bind(events),
                getSteerMessages: getMessages,
                getFollowUpMessages: getMessages,
            };
            const screen = mountState('a', backend);
            const visibleQueue = () =>
                queue === 'steer'
                    ? screen.getState().steerMessages
                    : screen.getState().queuedMessages;
            try {
                await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
                events.emit('message:queued', { sessionId: 'a', queue, id: 'old', position: 1 });
                expect(getMessages).toHaveBeenCalledWith('a');
                screen.getState().setSession((previous) => ({ ...previous, id: 'b' }));
                await vi.waitFor(() => expect(screen.getState().session.id).toBe('b'));
                events.emit('message:queued', {
                    sessionId: 'b',
                    queue,
                    id: 'current',
                    position: 1,
                });
                await vi.waitFor(() => expect(visibleQueue()).toEqual(current));
                release([
                    { id: 'old', content: [{ type: 'text', text: 'old task' }], queuedAt: 0 },
                ]);
                await pending;
                screen.getState().setUi((previous) => ({ ...previous, isThinking: true }));
                await vi.waitFor(() => expect(screen.getState().ui.isThinking).toBe(true));
                expect(visibleQueue()).toEqual(current);
            } finally {
                release([]);
                screen.close();
            }
        }
    );
});
