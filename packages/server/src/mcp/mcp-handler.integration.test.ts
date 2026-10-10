import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentCard, DextoAgent } from '@dexto/core';
import { initializeMcpServer, initializeAgentCardResource } from './mcp-handler.js';

// Agent execution is stubbed; requests use the real MCP client/server protocol.
vi.mock('@dexto/core', () => ({ logger: { info: vi.fn() } }));

function agentFixture(answer: string) {
    const fixture = {
        logger: { info: vi.fn(), warn: vi.fn() },
        createSession: vi.fn(async (id: string) => ({ id })),
        run: vi.fn(async () => answer),
        deleteSession: vi.fn(async () => undefined),
    };
    return { agent: fixture as unknown as DextoAgent, ...fixture };
}

function card(name: string): AgentCard {
    return {
        name,
        description: 'Fixture agent',
        version: '1.0.0',
        url: 'http://localhost',
        capabilities: {},
        skills: [],
    };
}

const connections: { client: Client; server: McpServer }[] = [];
async function connectMcp(
    initialize: (transport: Transport) => Promise<McpServer>
): Promise<Client> {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = await initialize(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    connections.push({ client, server });
    await client.connect(clientTransport);
    return client;
}

afterEach(async () => {
    for (const { client, server } of connections.splice(0)) {
        await client.close();
        await server.close();
    }
});

describe('MCP current agent', () => {
    it('advertises the existing chat schema and static resource metadata', async () => {
        const initial = agentFixture('answer');
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, card('initial'), transport)
        );
        expect(await client.listTools()).toEqual({
            tools: [
                {
                    name: 'chat_with_agent',
                    description:
                        'Allows you to chat with the an AI agent. Send a message to interact.',
                    inputSchema: {
                        $schema: 'http://json-schema.org/draft-07/schema#',
                        type: 'object',
                        properties: { message: { type: 'string' } },
                        required: ['message'],
                    },
                    execution: { taskSupport: 'forbidden' },
                },
            ],
        });
        expect(await client.listResources()).toEqual({
            resources: [{ uri: 'dexto://agent/card', name: 'agentCard' }],
        });
    });
    it('rejects invalid chat input before selecting an agent or creating a session', async () => {
        const initial = agentFixture('answer');
        const getAgent = vi.fn(() => initial.agent);
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, card('initial'), transport, {
                getAgent,
                getAgentCard: () => card('initial'),
            })
        );
        const result = await client.callTool({
            name: 'chat_with_agent',
            arguments: { message: 42 },
        });
        expect(result.isError).toBe(true);
        expect(getAgent).not.toHaveBeenCalled();
        expect(initial.createSession).not.toHaveBeenCalled();
        expect(initial.run).not.toHaveBeenCalled();
        expect(initial.deleteSession).not.toHaveBeenCalled();
    });

    it('routes new chat requests to the current agent after a switch', async () => {
        const initial = agentFixture('initial answer');
        const replacement = agentFixture('replacement answer');
        let current = initial.agent;
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, card('initial'), transport, {
                getAgent: () => current,
                getAgentCard: () => card('replacement'),
            })
        );
        await client.callTool({ name: 'chat_with_agent', arguments: { message: 'before' } });
        current = replacement.agent;
        initial.createSession.mockRejectedValue(new Error('initial agent stopped'));
        const result = await client.callTool({
            name: 'chat_with_agent',
            arguments: { message: 'after' },
        });
        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: 'replacement answer' }]);
        expect(replacement.createSession).toHaveBeenCalledOnce();
        expect(replacement.run).toHaveBeenCalledOnce();
        expect(replacement.deleteSession).toHaveBeenCalledWith(
            replacement.createSession.mock.calls[0]?.[0]
        );
    });
    it('returns the current card after a switch', async () => {
        const initial = agentFixture('answer');
        let currentCard = card('initial');
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, currentCard, transport, {
                getAgent: () => initial.agent,
                getAgentCard() {
                    return this.getAgent() === initial.agent ? currentCard : card('unexpected');
                },
            })
        );
        currentCard = { ...card('replacement'), version: '2.0.0' };
        expect(client.getServerVersion()).toEqual({ name: 'initial', version: '1.0.0' });
        const resource = await client.readResource({ uri: 'dexto://agent/card' });
        expect(resource.contents).toEqual([
            { uri: 'dexto://agent/card', text: JSON.stringify(currentCard, null, 2) },
        ]);
    });

    it('preserves static three-argument callers', async () => {
        const initial = agentFixture('static answer');
        const initialCard = card('static');
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, initialCard, transport)
        );
        const result = await client.callTool({
            name: 'chat_with_agent',
            arguments: { message: 'hello' },
        });
        expect(result.content).toEqual([{ type: 'text', text: 'static answer' }]);
        const resource = await client.readResource({ uri: 'dexto://agent/card' });
        expect(resource.contents[0]).toMatchObject({ text: JSON.stringify(initialCard, null, 2) });
        expect(initial.deleteSession).toHaveBeenCalledOnce();
    });

    it('keeps one call and its session cleanup on the agent selected at entry', async () => {
        const initial = agentFixture('initial answer');
        const replacement = agentFixture('replacement answer');
        let current = initial.agent;
        initial.createSession.mockImplementationOnce(async (id) => {
            current = replacement.agent;
            return { id };
        });
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, card('initial'), transport, {
                getAgent: () => current,
                getAgentCard: () => card('initial'),
            })
        );
        const result = await client.callTool({
            name: 'chat_with_agent',
            arguments: { message: 'hello' },
        });
        expect(result.content).toEqual([{ type: 'text', text: 'initial answer' }]);
        expect(initial.run).toHaveBeenCalledOnce();
        expect(initial.deleteSession).toHaveBeenCalledWith(
            initial.createSession.mock.calls[0]?.[0]
        );
        expect(replacement.run).not.toHaveBeenCalled();
        expect(replacement.deleteSession).not.toHaveBeenCalled();
    });

    it('reports unavailable host context without creating a session or returning a stale card', async () => {
        const initial = agentFixture('initial answer');
        const unavailable = () => {
            throw new Error('host unavailable');
        };
        const client = await connectMcp((transport) =>
            initializeMcpServer(initial.agent, card('initial'), transport, {
                getAgent: unavailable,
                getAgentCard: unavailable,
            })
        );
        const result = await client.callTool({
            name: 'chat_with_agent',
            arguments: { message: 'hello' },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: 'host unavailable' }]);
        expect(initial.createSession).not.toHaveBeenCalled();
        await expect(client.readResource({ uri: 'dexto://agent/card' })).rejects.toThrow(
            'host unavailable'
        );
    });
    it('preserves standalone three-argument card registration', async () => {
        const initial = agentFixture('answer');
        const staticCard = card('static');
        const client = await connectMcp(async (transport) => {
            const server = new McpServer({ name: 'static', version: '1.0.0' });
            await initializeAgentCardResource(server, staticCard, initial.agent.logger);
            await server.connect(transport);
            return server;
        });
        const resource = await client.readResource({ uri: 'dexto://agent/card' });
        expect(resource.contents[0]).toMatchObject({ text: JSON.stringify(staticCard, null, 2) });
    });
});
