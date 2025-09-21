import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentServices } from './utils/service-initializer.js';
import { AgentConfigSchema, type ValidatedAgentConfig } from './agent/schemas.js';
import { MCPClient } from './mcp/mcp-client.js';
import { UserApprovalProvider } from './tools/confirmation/user-approval-provider.js';
import {
    AgentEventBus,
    type ToolConfirmationResponse,
    type ElicitationResponse,
} from './events/index.js';

interface AgentServices {
    agentEventBus: AgentEventBus;
    toolManager: {
        confirmationProvider: UserApprovalProvider;
    };
}

describe('User Approval End-to-End', () => {
    let agentServices: AgentServices;
    let agentEventBus: AgentEventBus;
    let userApprovalProvider: UserApprovalProvider;

    beforeEach(async () => {
        // Create minimal config for testing
        const minimalConfig = {
            llm: {
                model: 'claude-3-5-sonnet-20240620',
                provider: 'anthropic',
                apiKey: 'test-api-key',
            },
            toolConfirmation: {
                mode: 'event-based' as const,
                timeout: 5000,
                allowedToolsStorage: 'memory' as const,
            },
            mcpServers: {},
            systemPrompt: {},
            storage: {
                cache: { type: 'in-memory' as const },
                database: { type: 'in-memory' as const },
            },
            internalTools: [],
            blobStorage: { type: 'local' as const },
            internalResources: [],
        };

        const validatedConfig = AgentConfigSchema.parse(minimalConfig);
        agentServices = await createAgentServices(validatedConfig);
        agentEventBus = agentServices.agentEventBus;

        // Get the approval provider from the tool manager
        userApprovalProvider = (agentServices.toolManager as any).confirmationProvider;
        expect(userApprovalProvider).toBeInstanceOf(UserApprovalProvider);
    });

    it('should handle tool confirmation request and response', async () => {
        // Set up event listeners to simulate UI response
        const eventPromise = new Promise((resolve) => {
            agentEventBus.once('dexto:toolConfirmationRequest', (event) => {
                // Simulate user approving the tool after a short delay
                setTimeout(() => {
                    const response: ToolConfirmationResponse = {
                        executionId: event.executionId,
                        approved: true,
                        rememberChoice: false,
                    };
                    if (event.sessionId) {
                        response.sessionId = event.sessionId;
                    }
                    agentEventBus.emit('dexto:toolConfirmationResponse', response);
                }, 10);
                resolve(event);
            });
        });

        // Request tool confirmation
        const confirmationPromise = userApprovalProvider.requestConfirmation({
            toolName: 'test_tool',
            args: { param: 'value' },
            description: 'Test tool for verification',
            sessionId: 'test-session',
        });

        // Wait for both the event and the result
        const [event, result] = await Promise.all([eventPromise, confirmationPromise]);

        // Verify the tool was approved
        expect(result).toBe(true);
        expect(event).toMatchObject({
            toolName: 'test_tool',
            args: { param: 'value' },
            description: 'Test tool for verification',
            sessionId: 'test-session',
        });
    });

    it('should handle elicitation request and response', async () => {
        // Set up event listeners to simulate UI response
        const eventPromise = new Promise((resolve) => {
            agentEventBus.once('dexto:elicitationRequest', (event) => {
                // Simulate user providing data after a short delay
                setTimeout(() => {
                    const response: ElicitationResponse = {
                        executionId: event.executionId,
                        action: 'accept',
                        data: { username: 'testuser', age: 25 },
                    };
                    if (event.sessionId) {
                        response.sessionId = event.sessionId;
                    }
                    agentEventBus.emit('dexto:elicitationResponse', response);
                }, 10);
                resolve(event);
            });
        });

        // Request elicitation
        const elicitationPromise = userApprovalProvider.requestElicitation({
            message: 'Please provide your user information',
            requestedSchema: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Your username' },
                    age: { type: 'number', description: 'Your age' },
                },
                required: ['username'],
            },
            sessionId: 'test-session',
        });

        // Wait for both the event and the result
        const [event, result] = await Promise.all([eventPromise, elicitationPromise]);

        // Verify the elicitation was handled correctly
        expect(result.action).toBe('accept');
        expect(result.data).toEqual({ username: 'testuser', age: 25 });
        expect(event).toMatchObject({
            message: 'Please provide your user information',
            requestedSchema: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Your username' },
                    age: { type: 'number', description: 'Your age' },
                },
                required: ['username'],
            },
            sessionId: 'test-session',
        });
    });

    it('should handle MCP client elicitation through approval provider', async () => {
        // Create a mock MCP client and set up approval provider
        const mockClient = new MCPClient();
        mockClient.setApprovalProvider(userApprovalProvider);

        // Set up event listener for elicitation
        const eventPromise = new Promise((resolve) => {
            agentEventBus.once('dexto:elicitationRequest', (event) => {
                // Simulate user declining the request
                setTimeout(() => {
                    const response: ElicitationResponse = {
                        executionId: event.executionId,
                        action: 'decline',
                    };
                    if (event.sessionId) {
                        response.sessionId = event.sessionId;
                    }
                    agentEventBus.emit('dexto:elicitationResponse', response);
                }, 10);
                resolve(event);
            });
        });

        // Request elicitation through MCP client
        const elicitationPromise = mockClient.handleElicitationRequest({
            message: 'Provide your API key',
            requestedSchema: {
                type: 'object',
                properties: {
                    apiKey: { type: 'string', description: 'Your API key' },
                },
                required: ['apiKey'],
            },
            sessionId: 'test-session',
        });

        // Wait for both the event and the result
        const [event, result] = await Promise.all([eventPromise, elicitationPromise]);

        // Verify the request was handled through the MCP client
        expect(result.action).toBe('decline');
        expect(event).toMatchObject({
            message: 'Provide your API key',
            serverName: 'Unknown MCP Server', // Default server name
            sessionId: 'test-session',
        });
    });

    it('should handle concurrent requests correctly', async () => {
        // Set up automated responses for multiple requests
        let responseCount = 0;
        agentEventBus.on('dexto:toolConfirmationRequest', (event) => {
            setTimeout(() => {
                const response: ToolConfirmationResponse = {
                    executionId: event.executionId,
                    approved: true,
                };
                if (event.sessionId) {
                    response.sessionId = event.sessionId;
                }
                agentEventBus.emit('dexto:toolConfirmationResponse', response);
            }, 10);
        });

        agentEventBus.on('dexto:elicitationRequest', (event) => {
            setTimeout(() => {
                const response: ElicitationResponse = {
                    executionId: event.executionId,
                    action: 'accept',
                    data: { response: `response-${responseCount++}` },
                };
                if (event.sessionId) {
                    response.sessionId = event.sessionId;
                }
                agentEventBus.emit('dexto:elicitationResponse', response);
            }, 15);
        });

        // Make multiple concurrent requests
        const promises = [
            userApprovalProvider.requestConfirmation({
                toolName: 'tool1',
                args: {},
                sessionId: 'session1',
            }),
            userApprovalProvider.requestElicitation({
                message: 'Request 1',
                requestedSchema: { type: 'object', properties: { response: { type: 'string' } } },
                sessionId: 'session1',
            }),
            userApprovalProvider.requestConfirmation({
                toolName: 'tool2',
                args: {},
                sessionId: 'session2',
            }),
            userApprovalProvider.requestElicitation({
                message: 'Request 2',
                requestedSchema: { type: 'object', properties: { response: { type: 'string' } } },
                sessionId: 'session2',
            }),
        ];

        // Wait for all requests to complete
        const results = await Promise.all(promises);

        // Verify all requests were handled correctly
        expect(results[0]).toBe(true); // Tool confirmation 1
        expect((results[1] as any).action).toBe('accept'); // Elicitation 1
        expect(results[2]).toBe(true); // Tool confirmation 2
        expect((results[3] as any).action).toBe('accept'); // Elicitation 2

        // Verify different data was returned
        expect((results[1] as any).data).toEqual({ response: 'response-0' });
        expect((results[3] as any).data).toEqual({ response: 'response-1' });
    });

    it('should enforce timeouts correctly', async () => {
        // Create a provider with very short timeout
        const shortTimeoutProvider = new UserApprovalProvider(
            userApprovalProvider.allowedToolsProvider,
            agentEventBus,
            { confirmationTimeout: 100 }
        );

        // Request confirmation without providing response (should timeout)
        const confirmationPromise = shortTimeoutProvider.requestConfirmation({
            toolName: 'timeout_tool',
            args: {},
        });

        // Should reject with timeout error
        await expect(confirmationPromise).rejects.toThrow(/timed out/);

        // Request elicitation without providing response (should timeout)
        const elicitationPromise = shortTimeoutProvider.requestElicitation({
            message: 'This will timeout',
            requestedSchema: { type: 'object' },
        });

        // Should reject with timeout error
        await expect(elicitationPromise).rejects.toThrow(/timed out/);
    });
});
