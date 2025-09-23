import { describe, it, expect, beforeEach } from 'vitest';
import { MCPManager } from './manager.js';
import { MCPClient } from './mcp-client.js';
import { UserApprovalProvider } from '../tools/confirmation/user-approval-provider.js';
import { InMemoryAllowedToolsProvider } from '../tools/confirmation/allowed-tools-provider/in-memory.js';
import { AgentEventBus } from '../events/index.js';

describe('MCP Elicitation Integration', () => {
    let mcpManager: MCPManager;
    let userApprovalProvider: UserApprovalProvider;
    let agentEventBus: AgentEventBus;

    beforeEach(() => {
        mcpManager = new MCPManager();
        agentEventBus = new AgentEventBus();

        const allowedToolsProvider = new InMemoryAllowedToolsProvider();
        userApprovalProvider = new UserApprovalProvider(allowedToolsProvider, agentEventBus, {
            confirmationTimeout: 1000,
        });
    });

    it('should integrate UserApprovalProvider with MCP clients', () => {
        // Create a mock MCP client
        const mockClient = new MCPClient();

        // Register it with the manager
        mcpManager.registerClient('test-server', mockClient);

        // Set the approval provider
        mcpManager.setApprovalProvider(userApprovalProvider);

        // Verify the client has the approval provider
        expect((mockClient as any).approvalProvider).toBe(userApprovalProvider);
    });

    it('should handle elicitation requests through MCP client', async () => {
        const mockClient = new MCPClient();

        // Set up the approval provider
        (mockClient as any).setApprovalProvider(userApprovalProvider);

        // Set up an event listener to auto-respond to elicitation
        const eventPromise = new Promise((resolve) => {
            agentEventBus.once('dexto:elicitationRequest', (event) => {
                // Auto-respond with test data
                agentEventBus.emit('dexto:elicitationResponse', {
                    executionId: event.executionId,
                    action: 'accept',
                    data: { username: 'testuser' },
                });
                resolve(event);
            });
        });

        // Request elicitation
        const resultPromise = mockClient.requestElicitation({
            message: 'Please provide your username',
            requestedSchema: {
                type: 'object',
                properties: {
                    username: { type: 'string' },
                },
                required: ['username'],
            },
        });

        // Wait for the event and result
        const [event, result] = await Promise.all([eventPromise, resultPromise]);

        // Verify the elicitation request was handled
        expect(event).toMatchObject({
            message: 'Please provide your username',
            requestedSchema: {
                type: 'object',
                properties: {
                    username: { type: 'string' },
                },
                required: ['username'],
            },
            serverName: 'Unknown MCP Server', // Default server name
        });

        expect(result).toMatchObject({
            action: 'accept',
            data: { username: 'testuser' },
        });
    });

    it('should handle elicitation request through handleElicitationRequest method', async () => {
        const mockClient = new MCPClient();

        // Set up the approval provider
        (mockClient as any).setApprovalProvider(userApprovalProvider);

        // Set up an event listener to auto-respond
        agentEventBus.once('dexto:elicitationRequest', (event) => {
            agentEventBus.emit('dexto:elicitationResponse', {
                executionId: event.executionId,
                action: 'decline',
                sessionId: event.sessionId,
            });
        });

        // Use the handleElicitationRequest method (what would be called by MCP SDK)
        const result = await mockClient.handleElicitationRequest({
            message: 'Provide your API key',
            requestedSchema: { type: 'object' },
            sessionId: 'session-123',
        });

        expect(result.action).toBe('decline');
        expect(result.sessionId).toBe('session-123');
    });

    it('should throw error when no approval provider is set', async () => {
        const mockClient = new MCPClient();

        // Don't set approval provider

        await expect(
            mockClient.requestElicitation({
                message: 'Test message',
                requestedSchema: { type: 'object' },
            })
        ).rejects.toThrow('No approval provider available for elicitation');
    });
});
