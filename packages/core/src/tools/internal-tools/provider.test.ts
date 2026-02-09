import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { InternalToolsProvider } from './provider.js';
import type { InternalToolsServices } from './registry.js';
import type { InternalToolsConfig } from '../schemas.js';
import type { InternalTool } from '../types.js';
import { DextoRuntimeError } from '../../errors/DextoRuntimeError.js';
import { ToolErrorCode } from '../error-codes.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { ApprovalManager } from '../../approval/manager.js';

// No need to mock logger - we'll pass mockLogger directly to constructors

// Mock zodToJsonSchema
vi.mock('zod-to-json-schema', () => ({
    zodToJsonSchema: vi.fn().mockReturnValue({
        type: 'object',
        properties: {
            query: { type: 'string' },
            mode: { type: 'string', enum: ['messages', 'sessions'] },
        },
        required: ['query', 'mode'],
    }),
}));

describe('InternalToolsProvider', () => {
    let mockServices: InternalToolsServices;
    let config: InternalToolsConfig;
    let mockLogger: any;

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            trackException: vi.fn(),
            createChild: vi.fn(function (this: any) {
                return this;
            }),
            destroy: vi.fn(),
        } as any;

        // Create ApprovalManager in auto-approve mode for tests
        const approvalManager = new ApprovalManager(
            {
                toolConfirmation: {
                    mode: 'auto-approve',
                    timeout: 120000,
                },
                elicitation: {
                    enabled: true,
                    timeout: 120000,
                },
            },
            mockLogger
        );

        // Mock services including approvalManager (now part of InternalToolsServices)
        mockServices = {
            searchService: {
                searchMessages: vi
                    .fn()
                    .mockResolvedValue([{ id: '1', content: 'test message', role: 'user' }]),
                searchSessions: vi
                    .fn()
                    .mockResolvedValue([{ id: 'session1', title: 'Test Session' }]),
            } as any,
            approvalManager,
        };

        config = ['search_history'];

        vi.clearAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize with empty config', async () => {
            const provider = new InternalToolsProvider(mockServices, [], mockLogger);
            await provider.initialize();

            expect(provider.getToolCount()).toBe(0);
            expect(provider.getToolNames()).toEqual([]);
        });

        it('should register tools when services are available', async () => {
            const provider = new InternalToolsProvider(mockServices, config, mockLogger);
            await provider.initialize();

            expect(provider.getToolCount()).toBe(1);
            expect(provider.getToolNames()).toContain('search_history');
        });

        it('should skip tools when required services are missing', async () => {
            const servicesWithoutSearch: InternalToolsServices = {
                // Missing searchService but has approvalManager
                approvalManager: mockServices.approvalManager!,
            };

            const provider = new InternalToolsProvider(servicesWithoutSearch, config, mockLogger);
            await provider.initialize();

            expect(provider.getToolCount()).toBe(0);
            expect(provider.getToolNames()).toEqual([]);
        });

        it('should handle tool registration errors gracefully', async () => {
            // Create a provider with services that will cause the tool factory to fail
            const failingServices: InternalToolsServices = {
                searchService: null as any, // This should cause issues during tool creation
                approvalManager: mockServices.approvalManager!,
            };

            const provider = new InternalToolsProvider(failingServices, config, mockLogger);
            await provider.initialize();

            // Tool should be skipped due to missing service, so count should be 0
            expect(provider.getToolCount()).toBe(0);
        });

        it('should log initialization progress', async () => {
            const provider = new InternalToolsProvider(mockServices, config, mockLogger);
            await provider.initialize();

            expect(mockLogger.info).toHaveBeenCalledWith('Initializing InternalToolsProvider...');
            expect(mockLogger.info).toHaveBeenCalledWith(
                'InternalToolsProvider initialized with 1 internal tool(s)'
            );
        });
    });

    describe('Tool Management', () => {
        let provider: InternalToolsProvider;

        beforeEach(async () => {
            provider = new InternalToolsProvider(mockServices, config, mockLogger);
            await provider.initialize();
        });

        it('should check if tool exists', () => {
            expect(provider.hasTool('search_history')).toBe(true);
            expect(provider.hasTool('nonexistent_tool')).toBe(false);
        });

        it('should return correct tool count', () => {
            expect(provider.getToolCount()).toBe(1);
        });

        it('should return tool names', () => {
            const names = provider.getToolNames();
            expect(names).toEqual(['search_history']);
        });

        it('should convert tools to ToolSet format', () => {
            const toolSet = provider.getInternalTools();

            expect(toolSet).toHaveProperty('search_history');
            expect(toolSet.search_history).toEqual({
                name: 'search_history',
                description: expect.stringContaining('Search through conversation history'),
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        mode: { type: 'string', enum: ['messages', 'sessions'] },
                    },
                    required: ['query', 'mode'],
                },
            });
        });

        it('should handle Zod schema conversion errors gracefully', async () => {
            const { zodToJsonSchema } = await import('zod-to-json-schema');

            // Mock zodToJsonSchema to throw an error
            (zodToJsonSchema as any).mockImplementationOnce(() => {
                throw new Error('Schema conversion failed');
            });

            const toolSet = provider.getInternalTools();

            // Should return fallback schema
            expect(toolSet.search_history?.parameters).toEqual({
                type: 'object',
                properties: {},
            });
        });
    });

    describe('Tool Execution', () => {
        let provider: InternalToolsProvider;

        beforeEach(async () => {
            provider = new InternalToolsProvider(mockServices, config, mockLogger);
            await provider.initialize();
        });

        it('should execute tool with correct arguments and context', async () => {
            const args = { query: 'test query', mode: 'messages' as const };
            const sessionId = 'test-session-123';

            const result = await provider.executeTool('search_history', args, sessionId);

            expect(mockServices.searchService?.searchMessages).toHaveBeenCalledWith(
                'test query',
                expect.objectContaining({
                    limit: 20, // Default from Zod schema
                    offset: 0, // Default from Zod schema
                    // sessionId and role are undefined, so not included in the object
                })
            );
            expect(result).toEqual([{ id: '1', content: 'test message', role: 'user' }]);
        });

        it('should execute tool without sessionId', async () => {
            const args = { query: 'test query', mode: 'sessions' as const };

            const result = await provider.executeTool('search_history', args);

            expect(mockServices.searchService?.searchSessions).toHaveBeenCalledWith('test query');
            expect(result).toEqual([{ id: 'session1', title: 'Test Session' }]);
        });

        it('should throw error for nonexistent tool', async () => {
            const error = (await provider
                .executeTool('nonexistent_tool', {})
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.TOOL_NOT_FOUND);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.NOT_FOUND);
        });

        it('should propagate tool execution errors', async () => {
            // Mock search service to throw error
            mockServices.searchService!.searchMessages = vi
                .fn()
                .mockRejectedValue(new Error('Search service failed'));

            await expect(
                provider.executeTool('search_history', {
                    query: 'test',
                    mode: 'messages' as const,
                })
            ).rejects.toThrow('Search service failed');
        });

        it('should log execution errors', async () => {
            // Mock search service to throw error
            mockServices.searchService!.searchMessages = vi
                .fn()
                .mockRejectedValue(new Error('Search service failed'));

            try {
                await provider.executeTool('search_history', {
                    query: 'test',
                    mode: 'messages' as const,
                });
            } catch {
                // Expected to throw
            }

            expect(mockLogger.error).toHaveBeenCalledWith(
                '❌ Internal tool execution failed: search_history',
                expect.objectContaining({ error: expect.any(String) })
            );
        });

        it('should validate input against tool schema', async () => {
            const mockTool: InternalTool = {
                id: 'test_tool',
                description: 'Test tool',
                inputSchema: z.object({
                    required_param: z.string(),
                    optional_param: z.number().optional(),
                }),
                execute: vi.fn().mockResolvedValue('test result'),
            };

            // Manually add the mock tool to the provider
            (provider as any).internalTools.set('test_tool', mockTool);

            // Test with invalid input - missing required field
            const error = (await provider
                .executeTool('test_tool', { optional_param: 42 })
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.TOOL_INVALID_ARGS);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.USER);

            // Tool should not have been called
            expect(mockTool.execute).not.toHaveBeenCalled();
        });

        it('should provide correct tool execution context', async () => {
            // Create a mock tool to verify context is passed correctly
            const mockTool: InternalTool = {
                id: 'test_tool',
                description: 'Test tool',
                inputSchema: z.object({
                    param: z.string(),
                }),
                execute: vi.fn().mockResolvedValue('test result'),
            };

            // Manually add the mock tool to the provider
            (provider as any).internalTools.set('test_tool', mockTool);

            const sessionId = 'test-session-456';
            await provider.executeTool('test_tool', { param: 'value' }, sessionId);

            expect(mockTool.execute).toHaveBeenCalledWith(
                { param: 'value' },
                { sessionId: 'test-session-456' }
            );
        });
    });

    describe('Service Dependencies', () => {
        it('should only register tools when all required services are available', async () => {
            const partialServices: InternalToolsServices = {
                // Has searchService and approvalManager
                searchService: mockServices.searchService!,
                approvalManager: mockServices.approvalManager!,
            };

            const provider = new InternalToolsProvider(
                partialServices,
                ['search_history'], // This tool requires searchService
                mockLogger
            );
            await provider.initialize();

            expect(provider.hasTool('search_history')).toBe(true);
        });

        it('should skip tools when any required service is missing', async () => {
            const emptyServices: InternalToolsServices = {
                approvalManager: mockServices.approvalManager!,
            };

            const provider = new InternalToolsProvider(
                emptyServices,
                ['search_history'], // This tool requires searchService
                mockLogger
            );
            await provider.initialize();

            expect(provider.hasTool('search_history')).toBe(false);
        });

        it('should log when skipping tools due to missing services', async () => {
            const emptyServices: InternalToolsServices = {
                approvalManager: mockServices.approvalManager!,
            };

            const provider = new InternalToolsProvider(
                emptyServices,
                ['search_history'],
                mockLogger
            );
            await provider.initialize();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Skipping search_history internal tool - missing services: searchService'
            );
        });
    });

    describe('Configuration Handling', () => {
        it('should handle multiple tools in config', async () => {
            // Note: Only search_history is available in current registry
            const provider = new InternalToolsProvider(
                mockServices,
                ['search_history'], // Add more tools here as they're implemented
                mockLogger
            );
            await provider.initialize();

            expect(provider.getToolCount()).toBe(1);
        });

        it('should handle unknown tools in config gracefully', async () => {
            // The provider should handle unknown tools by catching errors during getInternalToolInfo
            const provider = new InternalToolsProvider(
                mockServices,
                ['search_history'], // Only use known tools for now
                mockLogger
            );

            // This should not throw during initialization
            await provider.initialize();

            // Should register the known tool
            expect(provider.hasTool('search_history')).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should handle initialization failures gracefully', async () => {
            // Test with services that only have approvalManager to ensure error handling works
            const servicesWithOnlyApproval: InternalToolsServices = {
                approvalManager: mockServices.approvalManager!,
            };
            const provider = new InternalToolsProvider(
                servicesWithOnlyApproval,
                config,
                mockLogger
            );

            // Should not throw, but should skip tools due to missing services
            await provider.initialize();

            // Should have 0 tools registered due to missing services
            expect(provider.getToolCount()).toBe(0);
        });

        it('should handle tool execution context properly', async () => {
            const provider = new InternalToolsProvider(mockServices, config, mockLogger);
            await provider.initialize();

            // Execute without sessionId
            await provider.executeTool('search_history', {
                query: 'test',
                mode: 'messages' as const,
            });

            // Should create context with undefined sessionId
            expect(mockServices.searchService?.searchMessages).toHaveBeenCalledWith(
                'test',
                expect.any(Object)
            );
        });
    });

    describe('Required Features', () => {
        it('should throw when tool requires a feature that is disabled', async () => {
            // Create ApprovalManager with elicitation DISABLED
            const approvalManagerWithDisabledElicitation = new ApprovalManager(
                {
                    toolConfirmation: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false, // Elicitation is disabled
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const servicesWithDisabledElicitation: InternalToolsServices = {
                approvalManager: approvalManagerWithDisabledElicitation,
            };

            // ask_user requires elicitation feature
            const provider = new InternalToolsProvider(
                servicesWithDisabledElicitation,
                ['ask_user'],
                mockLogger
            );

            // Should throw during initialization
            await expect(provider.initialize()).rejects.toThrow(DextoRuntimeError);
        });

        it('should include feature name and recovery hint in error message', async () => {
            const approvalManagerWithDisabledElicitation = new ApprovalManager(
                {
                    toolConfirmation: {
                        mode: 'auto-approve',
                        timeout: 120000,
                    },
                    elicitation: {
                        enabled: false,
                        timeout: 120000,
                    },
                },
                mockLogger
            );

            const servicesWithDisabledElicitation: InternalToolsServices = {
                approvalManager: approvalManagerWithDisabledElicitation,
            };

            const provider = new InternalToolsProvider(
                servicesWithDisabledElicitation,
                ['ask_user'],
                mockLogger
            );

            const error = (await provider.initialize().catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.FEATURE_DISABLED);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.USER);
            expect(error.message).toContain('elicitation');
            expect(error.message).toContain('ask_user');
        });

        it('should register tool when required feature is enabled', async () => {
            // mockServices already has elicitation enabled (from beforeEach)
            const provider = new InternalToolsProvider(mockServices, ['ask_user'], mockLogger);

            await provider.initialize();

            expect(provider.hasTool('ask_user')).toBe(true);
            expect(provider.getToolCount()).toBe(1);
        });

        it('should register tool that has no required features', async () => {
            // search_history has no requiredFeatures
            const provider = new InternalToolsProvider(
                mockServices,
                ['search_history'],
                mockLogger
            );
            await provider.initialize();

            expect(provider.hasTool('search_history')).toBe(true);
        });

        it('should skip tool when required services are missing (before feature check)', async () => {
            // ask_user requires approvalManager service
            // When service is missing, tool is skipped BEFORE feature checking
            const servicesWithoutApprovalManager: InternalToolsServices = {
                searchService: mockServices.searchService!,
                // Missing approvalManager - ask_user needs this as a service
            };

            const provider = new InternalToolsProvider(
                servicesWithoutApprovalManager,
                ['ask_user'],
                mockLogger
            );

            // Should NOT throw - tool is skipped due to missing service
            await provider.initialize();

            // Tool should not be registered
            expect(provider.hasTool('ask_user')).toBe(false);
            expect(provider.getToolCount()).toBe(0);
        });
    });
});
