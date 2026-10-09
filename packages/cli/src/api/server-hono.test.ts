import { setImmediate } from 'node:timers';
import type { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { createConnection } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import type { createDextoApp } from '@dexto/server';
type AppOptions = Parameters<typeof createDextoApp>[0];

const owned = vi.hoisted(() => ({
    closeMcp: vi.fn(),
    cleanupSession: vi.fn(),
    cleanupSse: vi.fn(),
    cleanupWebhook: vi.fn(),
    abortApproval: vi.fn(),
    initializeMcp: vi.fn(),
    createAgent: vi.fn(),
    resolveAgent: vi.fn(),
    listAgents: vi.fn(),
    bridgeSubscriber: {},
    subscriberAgents: new Map<object, DextoAgent>(),
    approvalBridges: new Map<DextoAgent, AbortController>(),
}));
vi.mock('@dexto/server', async () => {
    const { createServer } = await import('node:http');
    const { Hono } = await import('hono');
    return {
        createDextoApp: vi.fn((options: AppOptions) =>
            new Hono().get('/test/agent', async (context) => {
                const activeAgent = await options.getAgent(context);
                return context.json({
                    id: activeAgent.config.agentId,
                    configPath: options.getAgentConfigPath?.(context),
                    cardName: options.getAgentCard().name,
                });
            })
        ),
        createNodeServer: vi.fn(() => {
            const server = createServer((_req, res) => res.end('ready'));
            server.on('close', owned.cleanupWebhook);
            return { server, webhookSubscriber: owned.bridgeSubscriber };
        }),
        createMcpTransport: vi.fn(async () => ({ close: owned.closeMcp })),
        createMcpHttpHandlers: vi.fn(() => null),
        initializeMcpServer: owned.initializeMcp,
        createManualApprovalHandler: vi.fn(() => ({ approve: vi.fn() })),
        WebhookEventSubscriber: class {
            cleanup = owned.cleanupWebhook;
        },
        A2ASseEventSubscriber: class {
            cleanup = owned.cleanupSse;
        },
        SessionSseEventSubscriber: class {
            cleanup = owned.cleanupSession;
        },
        ApprovalCoordinator: class {},
        wireApprovalCoordinatorToAgent: vi.fn((agent: DextoAgent) => {
            const controller = new AbortController();
            controller.signal.addEventListener('abort', owned.abortApproval);
            owned.approvalBridges.set(agent, controller);
            return controller;
        }),
    };
});
vi.mock('@dexto/agent-management', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@dexto/agent-management')>();
    return {
        ...actual,
        globalPreferencesExist: () => false,
        loadAgentConfig: vi.fn(async () => ({})),
        createDextoAgentFromConfig: owned.createAgent,
        getAgentRegistry: () => ({ resolveAgent: owned.resolveAgent }),
        AgentFactory: { listAgents: owned.listAgents },
    };
});
vi.mock('../utils/session-logger-factory.js', () => ({ createFileSessionLoggerFactory: vi.fn() }));

import { initializeHonoApi, startHonoApiServer } from './server-hono.js';

function fakeAgent() {
    let started = false;
    let stopped = false;
    const subscribers = new Set<object>();
    const start = vi.fn(async (): Promise<void> => {
        started = true;
        stopped = false;
        for (const subscriber of subscribers) owned.subscriberAgents.set(subscriber, agent);
    });
    const stop = vi.fn(async (): Promise<void> => {
        stopped = true;
        started = false;
    });
    // This boundary fixture replaces agent/provider execution, while sockets remain real.
    const agent = {
        config: {
            permissions: { mode: 'auto-approve' },
            elicitation: { enabled: false },
            agentCard: {},
            agentId: 'replacement',
        },
        start,
        stop,
        registerSubscriber: vi.fn((subscriber: object) => {
            subscribers.add(subscriber);
            if (started) owned.subscriberAgents.set(subscriber, agent);
        }),
        setApprovalHandler: vi.fn(),
        getWorkspace: vi.fn(async () => ({ path: '/workspace' })),
        setWorkspace: vi.fn(async (): Promise<void> => undefined),
        isStarted: () => started,
        isStopped: () => stopped,
    } as unknown as DextoAgent;
    return { agent, start, stop };
}

const resources: Array<{ server: Server; stop?: () => Promise<void> }> = [];
const processEvents: EventEmitter = process;
const signals = [
    'SIGTERM',
    'SIGUSR2',
    'SIGINT',
    'uncaughtException',
    'unhandledRejection',
] as const;
let previous = signals.map((signal) => processEvents.listeners(signal));

beforeEach(() => {
    vi.clearAllMocks();
    owned.subscriberAgents.clear();
    owned.approvalBridges.clear();
    owned.resolveAgent.mockResolvedValue('/fixtures/replacement.yml');
    owned.listAgents.mockResolvedValue({ installed: [], available: [] });
    owned.closeMcp.mockResolvedValue(undefined);
    owned.initializeMcp.mockResolvedValue(undefined);
    previous = signals.map((signal) => processEvents.listeners(signal));
});
afterEach(async () => {
    for (const resource of resources.splice(0)) {
        if (resource.stop) await resource.stop().catch(() => undefined);
        else if (resource.server.listening)
            await new Promise<void>((done) => resource.server.close(() => done()));
    }
    signals.forEach((signal, index) => {
        for (const listener of processEvents.listeners(signal)) {
            if (!previous[index]!.includes(listener))
                processEvents.removeListener(signal, listener as (...args: unknown[]) => void);
        }
    });
});

describe('CLI HTTP host lifecycle', () => {
    it('resolves startup only when the real socket is reachable', async () => {
        const { agent } = fakeAgent();
        const host = await startHonoApiServer(agent, 0);
        resources.push(host);
        const address = host.server.address();
        expect(address).not.toBeNull();
        if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
        const response = await fetch(`http://127.0.0.1:${address.port}`);
        expect(await response.text()).toBe('ready');
    });
    it('stops owned resources once and removes only host process hooks', async () => {
        const { agent, stop } = fakeAgent();
        const host = await initializeHonoApi(agent);
        resources.push(host);
        expect(host.stop).toBeTypeOf('function');
        await Promise.all([host.stop(), host.stop()]);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(owned.closeMcp).toHaveBeenCalledTimes(1);
        expect(owned.cleanupSession).toHaveBeenCalledTimes(1);
        expect(owned.cleanupSse).toHaveBeenCalledTimes(1);
        expect(owned.cleanupWebhook).toHaveBeenCalledTimes(1);
        expect(owned.abortApproval).toHaveBeenCalledTimes(1);
        signals.forEach((signal, index) =>
            expect(processEvents.listeners(signal)).toEqual(previous[index])
        );
    });
    it('rolls back acquired resources and preserves an occupied-port error', async () => {
        const occupied = createServer();
        await new Promise<void>((done) => occupied.listen(0, '0.0.0.0', done));
        resources.push({ server: occupied });
        const address = occupied.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
        const { agent, stop } = fakeAgent();
        await expect(startHonoApiServer(agent, address.port)).rejects.toMatchObject({
            code: 'EADDRINUSE',
        });
        expect(stop).toHaveBeenCalledTimes(1);
        expect(owned.closeMcp).toHaveBeenCalledTimes(1);
        signals.forEach((signal, index) =>
            expect(processEvents.listeners(signal)).toEqual(previous[index])
        );
    });

    it('rolls back failed agent startup without hiding its original error', async () => {
        const { agent, start, stop } = fakeAgent();
        const failure = new Error('agent startup failed');
        start.mockRejectedValueOnce(failure);
        stop.mockRejectedValueOnce(new Error('agent was not started'));
        await expect(initializeHonoApi(agent)).rejects.toBe(failure);
        expect(owned.closeMcp).toHaveBeenCalledTimes(1);
        expect(owned.cleanupSse).toHaveBeenCalledTimes(1);
        expect(owned.cleanupSession).toHaveBeenCalledTimes(1);
        expect(owned.abortApproval).toHaveBeenCalledTimes(1);
        signals.forEach((signal, index) =>
            expect(processEvents.listeners(signal)).toEqual(previous[index])
        );
    });

    it('closes a transport whose optional MCP initialization fails', async () => {
        const { agent } = fakeAgent();
        owned.initializeMcp.mockRejectedValueOnce(new Error('MCP setup failed'));
        const host = await initializeHonoApi(agent);
        resources.push(host);
        expect(host.mcpTransport).toBeUndefined();
        expect(owned.closeMcp).toHaveBeenCalledTimes(1);
        await host.stop();
        expect(owned.closeMcp).toHaveBeenCalledTimes(1);
    });

    it('attempts all cleanup and releases the port even when MCP cleanup fails', async () => {
        const { agent, stop } = fakeAgent();
        const host = await startHonoApiServer(agent, 0);
        resources.push(host);
        const address = host.server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
        owned.closeMcp.mockRejectedValueOnce(new Error('MCP close failed'));
        await expect(host.stop()).rejects.toThrow('Failed to stop CLI HTTP host');
        await expect(host.stop()).rejects.toThrow('Failed to stop CLI HTTP host');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(owned.cleanupSession).toHaveBeenCalledTimes(1);
        expect(owned.cleanupSse).toHaveBeenCalledTimes(1);
        expect(host.server.listening).toBe(false);
        const replacement = createServer();
        await new Promise<void>((done, reject) => {
            replacement.once('error', reject);
            replacement.listen(address.port, '0.0.0.0', done);
        });
        resources.push({ server: replacement });
    });
    it('stops the currently switched agent rather than stopping the initial agent again', async () => {
        const initial = fakeAgent();
        const replacement = fakeAgent();
        owned.createAgent.mockResolvedValueOnce(replacement.agent);
        const host = await initializeHonoApi(initial.agent);
        resources.push(host);
        await host.switchAgentByPath('replacement.yml');
        expect(initial.stop).toHaveBeenCalledTimes(1);
        expect(host.getActiveAgentId()).toBe('replacement');
        expect(() => host.ensureAgentAvailable()).not.toThrow();
        const response = await host.app.request('/test/agent');
        expect(await response.json()).toEqual({
            id: 'replacement',
            configPath: 'replacement.yml',
            cardName: 'replacement',
        });
        expect([...owned.subscriberAgents.values()]).toEqual([
            replacement.agent,
            replacement.agent,
            replacement.agent,
            replacement.agent,
        ]);
        expect(owned.approvalBridges.get(initial.agent)?.signal.aborted).toBe(true);
        expect(owned.approvalBridges.get(replacement.agent)?.signal.aborted).toBe(false);
        await host.stop();
        expect(initial.stop).toHaveBeenCalledTimes(1);
        expect(replacement.stop).toHaveBeenCalledTimes(1);
    });

    it('waits for an in-flight agent switch before stopping its resulting agent', async () => {
        const initial = fakeAgent();
        const replacement = fakeAgent();
        let finishStart: () => void = () => {
            throw new Error('Start not entered');
        };
        let notifyStart: () => void = () => {};
        const enteredStart = new Promise<void>((resolve) => {
            notifyStart = resolve;
        });
        replacement.start.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishStart = resolve;
                    notifyStart();
                })
        );
        owned.createAgent.mockResolvedValueOnce(replacement.agent);
        const host = await initializeHonoApi(initial.agent);
        resources.push(host);
        const switching = host.switchAgentByPath('replacement.yml');
        await enteredStart;
        const stopping = host.stop();
        await new Promise<void>((resolve) => setImmediate(resolve));
        const stoppedDuringStartup = replacement.stop.mock.calls.length;
        finishStart();
        await switching;
        await stopping;
        expect(stoppedDuringStartup).toBe(0);
        expect(replacement.stop).toHaveBeenCalledTimes(1);
        await expect(host.switchAgentByPath('again.yml')).rejects.toThrow();
    });
    it('closes active HTTP connections during stop', async () => {
        const { agent } = fakeAgent();
        const host = await startHonoApiServer(agent, 0);
        resources.push(host);
        const address = host.server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
        const socket = createConnection({ port: address.port, host: '127.0.0.1' });
        try {
            await new Promise<void>((resolve, reject) => {
                socket.once('connect', resolve);
                socket.once('error', reject);
            });
            const closed = new Promise<void>((resolve) => socket.once('close', resolve));
            await host.stop();
            await closed;
            expect(socket.destroyed).toBe(true);
        } finally {
            socket.destroy();
        }
    });
    it.each(['id', 'path'] as const)(
        'keeps the previous agent usable when replacement startup fails through %s',
        async (source) => {
            const initial = fakeAgent();
            initial.agent.config.agentId = 'initial';
            initial.agent.config.permissions.mode = 'manual';
            const replacement = fakeAgent();
            replacement.agent.config.permissions.mode = 'manual';
            const failure = new Error('replacement startup failed');
            replacement.start.mockRejectedValueOnce(failure);
            owned.createAgent.mockResolvedValueOnce(replacement.agent);
            const host = await initializeHonoApi(initial.agent, {}, 0, 'initial', 'initial.yml');
            resources.push(host);
            const oldHandler = vi.mocked(initial.agent.setApprovalHandler).mock.calls[0]?.[0];
            const switching =
                source === 'id'
                    ? host.switchAgentById('replacement')
                    : host.switchAgentByPath('replacement.yml');
            await expect(switching).rejects.toBe(failure);
            expect(host.getActiveAgentId()).toBe('initial');
            expect(() => host.ensureAgentAvailable()).not.toThrow();
            const response = await host.app.request('/test/agent');
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                id: 'initial',
                configPath: 'initial.yml',
                cardName: 'initial',
            });
            expect([...owned.subscriberAgents.values()]).toEqual([
                initial.agent,
                initial.agent,
                initial.agent,
                initial.agent,
            ]);
            expect(owned.approvalBridges.get(initial.agent)?.signal.aborted).toBe(false);
            expect(owned.approvalBridges.get(replacement.agent)?.signal.aborted).toBe(true);
            expect(initial.agent.setApprovalHandler).toHaveBeenCalledExactlyOnceWith(oldHandler);
            expect(initial.stop).not.toHaveBeenCalled();
            expect(replacement.stop).toHaveBeenCalledTimes(1);
        }
    );

    it('restores previous routing and subscriptions after workspace setup fails, even if replacement cleanup fails', async () => {
        const initial = fakeAgent();
        initial.agent.config.agentId = 'initial';
        initial.agent.config.permissions.mode = 'manual';
        const replacement = fakeAgent();
        replacement.agent.config.permissions.mode = 'manual';
        const failure = new Error('replacement workspace setup failed');
        vi.mocked(replacement.agent.getWorkspace).mockResolvedValueOnce({
            id: 'replacement-workspace',
            path: '/other',
            createdAt: 0,
            lastActiveAt: 0,
        });
        vi.mocked(replacement.agent.setWorkspace).mockRejectedValueOnce(failure);
        replacement.stop.mockRejectedValueOnce(new Error('replacement cleanup failed'));
        owned.createAgent.mockResolvedValueOnce(replacement.agent);
        const host = await initializeHonoApi(
            initial.agent,
            {},
            0,
            'initial',
            'initial.yml',
            '/workspace'
        );
        resources.push(host);
        await expect(host.switchAgentByPath('replacement.yml')).rejects.toBe(failure);
        expect(replacement.start).toHaveBeenCalledTimes(1);
        expect(host.getActiveAgentId()).toBe('initial');
        expect(() => host.ensureAgentAvailable()).not.toThrow();
        const response = await host.app.request('/test/agent');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: 'initial',
            configPath: 'initial.yml',
            cardName: 'initial',
        });
        expect([...owned.subscriberAgents.values()]).toEqual([
            initial.agent,
            initial.agent,
            initial.agent,
            initial.agent,
        ]);
        expect(owned.approvalBridges.get(initial.agent)?.signal.aborted).toBe(false);
        expect(owned.approvalBridges.get(replacement.agent)?.signal.aborted).toBe(true);
        expect(initial.stop).not.toHaveBeenCalled();
        expect(replacement.stop).toHaveBeenCalledTimes(1);
        await host.stop();
        expect(initial.stop).toHaveBeenCalledTimes(1);
        expect(replacement.stop).toHaveBeenCalledTimes(2);
    });

    it('keeps the previous agent when replacement display info cannot be resolved', async () => {
        const initial = fakeAgent();
        initial.agent.config.agentId = 'initial';
        const replacement = fakeAgent();
        const failure = new Error('registry unavailable');
        owned.listAgents.mockRejectedValueOnce(failure);
        owned.createAgent.mockResolvedValueOnce(replacement.agent);
        const host = await initializeHonoApi(initial.agent, {}, 0, 'initial', 'initial.yml');
        resources.push(host);
        await expect(host.switchAgentByPath('replacement.yml')).rejects.toBe(failure);
        expect(host.getActiveAgentId()).toBe('initial');
        expect(() => host.ensureAgentAvailable()).not.toThrow();
        const response = await host.app.request('/test/agent');
        expect(await response.json()).toEqual({
            id: 'initial',
            configPath: 'initial.yml',
            cardName: 'initial',
        });
        expect(initial.stop).not.toHaveBeenCalled();
        expect(replacement.stop).toHaveBeenCalledTimes(1);
    });

    it('retains ownership of the original agent when replacement startup fails', async () => {
        const initial = fakeAgent();
        const replacement = fakeAgent();
        replacement.start.mockRejectedValueOnce(new Error('replacement startup failed'));
        owned.createAgent.mockResolvedValueOnce(replacement.agent);
        const host = await initializeHonoApi(initial.agent);
        resources.push(host);
        await expect(host.switchAgentByPath('replacement.yml')).rejects.toThrow(
            'replacement startup failed'
        );
        expect(replacement.stop).toHaveBeenCalledTimes(1);
        expect(initial.stop).not.toHaveBeenCalled();
        await host.stop();
        expect(initial.stop).toHaveBeenCalledTimes(1);
        expect(replacement.stop).toHaveBeenCalledTimes(1);
    });
    it('retries an agent whose stop failed during a successful replacement', async () => {
        const initial = fakeAgent();
        const replacement = fakeAgent();
        initial.stop.mockRejectedValueOnce(new Error('initial stop failed'));
        owned.createAgent.mockResolvedValueOnce(replacement.agent);
        const host = await initializeHonoApi(initial.agent);
        resources.push(host);
        await host.switchAgentByPath('replacement.yml');
        expect(initial.stop).toHaveBeenCalledTimes(1);
        await host.stop();
        expect(initial.stop).toHaveBeenCalledTimes(2);
        expect(replacement.stop).toHaveBeenCalledTimes(1);
    });
});
