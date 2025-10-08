import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolManager } from './tool-manager.js';
import { MCPManager } from '../mcp/manager.js';
import { ToolConfirmationProvider } from './confirmation/types.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { AgentEventBus } from '../events/index.js';

// Mock logger
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ToolManager - Unit Tests (Pure Logic)', () => {
    let mockMcpManager: MCPManager;
    let mockConfirmationProvider: ToolConfirmationProvider;
    let mockAgentEventBus: AgentEventBus;

    beforeEach(() => {
        mockMcpManager = {
            getAllTools: vi.fn(),
            executeTool: vi.fn(),
            getToolClient: vi.fn(),
            refresh: vi.fn().mockResolvedValue(undefined),
        } as any;

        mockConfirmationProvider = {
            requestConfirmation: vi.fn(),
            allowedToolsProvider: {} as any,
        };

        mockAgentEventBus = {
            on: vi.fn(),
            emit: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            removeAllListeners: vi.fn(),
        } as any;

        vi.clearAllMocks();
    });

    describe('Tool Source Detection Logic', () => {
        it('should correctly identify MCP tools', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            expect(toolManager.getToolSource('mcp--file_read')).toBe('mcp');
            expect(toolManager.getToolSource('mcp--web_search')).toBe('mcp');
        });

        it('should correctly identify internal tools', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            expect(toolManager.getToolSource('internal--search_history')).toBe('internal');
            expect(toolManager.getToolSource('internal--config_manager')).toBe('internal');
        });

        it('should identify unknown tools', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            expect(toolManager.getToolSource('invalid_tool')).toBe('unknown');
            expect(toolManager.getToolSource('file_read')).toBe('unknown'); // No prefix
            expect(toolManager.getToolSource('')).toBe('unknown'); // Empty
        });

        it('should handle edge cases with empty tool names', () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            expect(toolManager.getToolSource('mcp--')).toBe('unknown'); // Prefix but no name
            expect(toolManager.getToolSource('internal--')).toBe('unknown'); // Prefix but no name
        });
    });

    describe('Tool Name Parsing Logic', () => {
        it('should extract actual tool name from MCP prefix', () => {
            const prefixedName = 'mcp--file_read';
            const actualName = prefixedName.substring('mcp--'.length);
            expect(actualName).toBe('file_read');
        });

        it('should extract actual tool name from internal prefix', () => {
            const prefixedName = 'internal--search_history';
            const actualName = prefixedName.substring('internal--'.length);
            expect(actualName).toBe('search_history');
        });

        it('should handle complex tool names', () => {
            const complexName = 'mcp--complex_tool_name_with_underscores';
            const actualName = complexName.substring('mcp--'.length);
            expect(actualName).toBe('complex_tool_name_with_underscores');
        });
    });

    describe('Tool Validation Logic', () => {
        beforeEach(() => {
            mockConfirmationProvider.requestConfirmation = vi.fn().mockResolvedValue(true);
        });

        it('should reject tools without proper prefix', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const error = (await toolManager
                .executeTool('invalid_tool', {})
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.TOOL_NOT_FOUND);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.NOT_FOUND);
        });

        it('should reject tools with prefix but no name', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const mcpError = (await toolManager
                .executeTool('mcp--', {})
                .catch((e) => e)) as DextoRuntimeError;
            expect(mcpError).toBeInstanceOf(DextoRuntimeError);
            expect(mcpError.code).toBe(ToolErrorCode.TOOL_INVALID_ARGS);
            expect(mcpError.scope).toBe(ErrorScope.TOOLS);
            expect(mcpError.type).toBe(ErrorType.USER);

            const internalError = (await toolManager
                .executeTool('internal--', {})
                .catch((e) => e)) as DextoRuntimeError;
            expect(internalError).toBeInstanceOf(DextoRuntimeError);
            expect(internalError.code).toBe(ToolErrorCode.TOOL_INVALID_ARGS);
            expect(internalError.scope).toBe(ErrorScope.TOOLS);
            expect(internalError.type).toBe(ErrorType.USER);

            // Should NOT call the underlying managers
            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
        });

        it('should reject internal tools when provider not initialized', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            await expect(toolManager.executeTool('internal--search_history', {})).rejects.toThrow(
                'Internal tools not initialized, cannot execute: internal--search_history'
            );
        });
    });

    describe('Confirmation Flow Logic', () => {
        it('should request confirmation with correct parameters', async () => {
            mockConfirmationProvider.requestConfirmation = vi.fn().mockResolvedValue(true);
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            await toolManager.executeTool('mcp--file_read', { path: '/test' }, 'session123');

            expect(mockConfirmationProvider.requestConfirmation).toHaveBeenCalledWith({
                toolName: 'mcp--file_read',
                args: { path: '/test' },
                sessionId: 'session123',
            });
        });

        it('should request confirmation without sessionId when not provided', async () => {
            mockConfirmationProvider.requestConfirmation = vi.fn().mockResolvedValue(true);
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('result');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            await toolManager.executeTool('mcp--file_read', { path: '/test' });

            expect(mockConfirmationProvider.requestConfirmation).toHaveBeenCalledWith({
                toolName: 'mcp--file_read',
                args: { path: '/test' },
            });
        });

        it('should throw execution denied error when confirmation denied', async () => {
            mockConfirmationProvider.requestConfirmation = vi.fn().mockResolvedValue(false);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const error = (await toolManager
                .executeTool('mcp--file_read', { path: '/test' }, 'session123')
                .catch((e) => e)) as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(ToolErrorCode.EXECUTION_DENIED);
            expect(error.scope).toBe(ErrorScope.TOOLS);
            expect(error.type).toBe(ErrorType.FORBIDDEN);

            expect(mockMcpManager.executeTool).not.toHaveBeenCalled();
        });

        it('should proceed with execution when confirmation approved', async () => {
            mockConfirmationProvider.requestConfirmation = vi.fn().mockResolvedValue(true);
            mockMcpManager.executeTool = vi.fn().mockResolvedValue('success');

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const result = await toolManager.executeTool('mcp--file_read', { path: '/test' });

            expect(mockMcpManager.executeTool).toHaveBeenCalledWith(
                'file_read',
                { path: '/test' },
                undefined
            );
            expect(result).toBe('success');
        });
    });

    describe('Cache Management Logic', () => {
        it('should cache tool discovery results', async () => {
            const tools = {
                test_tool: { name: 'test_tool', description: 'Test', parameters: {} },
            };
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(tools);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            // First call
            await toolManager.getAllTools();
            // Second call should use cache
            await toolManager.getAllTools();

            expect(mockMcpManager.getAllTools).toHaveBeenCalledTimes(1);
        });

        it('should invalidate cache on refresh', async () => {
            const tools = {
                test_tool: { name: 'test_tool', description: 'Test', parameters: {} },
            };
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(tools);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            // First call
            await toolManager.getAllTools();

            // Refresh should invalidate cache
            await toolManager.refresh();

            // Second call should fetch again
            await toolManager.getAllTools();

            expect(mockMcpManager.getAllTools).toHaveBeenCalledTimes(2);
        });
    });

    describe('Tool Statistics Logic', () => {
        it('should calculate statistics correctly', async () => {
            const mcpTools = {
                tool1: { name: 'tool1', description: 'Tool 1', parameters: {} },
                tool2: { name: 'tool2', description: 'Tool 2', parameters: {} },
            };

            mockMcpManager.getAllTools = vi.fn().mockResolvedValue(mcpTools);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const stats = await toolManager.getToolStats();

            expect(stats).toEqual({
                total: 2,
                mcp: 2,
                internal: 0,
            });
        });

        it('should handle empty tool sets', async () => {
            mockMcpManager.getAllTools = vi.fn().mockResolvedValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const stats = await toolManager.getToolStats();

            expect(stats).toEqual({
                total: 0,
                mcp: 0,
                internal: 0,
            });
        });

        it('should handle MCP errors gracefully in statistics', async () => {
            mockMcpManager.getAllTools = vi.fn().mockRejectedValue(new Error('MCP failed'));

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const stats = await toolManager.getToolStats();

            expect(stats).toEqual({
                total: 0,
                mcp: 0,
                internal: 0,
            });
        });
    });

    describe('Tool Existence Checking Logic', () => {
        it('should check MCP tool existence correctly', async () => {
            mockMcpManager.getToolClient = vi.fn().mockReturnValue({});

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const exists = await toolManager.hasTool('mcp--file_read');

            expect(mockMcpManager.getToolClient).toHaveBeenCalledWith('file_read');
            expect(exists).toBe(true);
        });

        it('should return false for non-existent MCP tools', async () => {
            mockMcpManager.getToolClient = vi.fn().mockReturnValue(undefined);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const exists = await toolManager.hasTool('mcp--nonexistent');

            expect(exists).toBe(false);
        });

        it('should return false for tools without proper prefix', async () => {
            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            const exists = await toolManager.hasTool('invalid_tool');

            expect(exists).toBe(false);
        });
    });

    describe('Error Propagation Logic', () => {
        beforeEach(() => {
            mockConfirmationProvider.requestConfirmation = vi.fn().mockResolvedValue(true);
        });

        it('should propagate MCP tool execution errors', async () => {
            const executionError = new Error('Tool execution failed');
            mockMcpManager.executeTool = vi.fn().mockRejectedValue(executionError);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            await expect(
                toolManager.executeTool('mcp--file_read', { path: '/test' })
            ).rejects.toThrow('Tool execution failed');
        });

        it('should propagate confirmation provider errors', async () => {
            const confirmationError = new Error('Confirmation failed');
            mockConfirmationProvider.requestConfirmation = vi
                .fn()
                .mockRejectedValue(confirmationError);

            const toolManager = new ToolManager(
                mockMcpManager,
                mockConfirmationProvider,
                mockAgentEventBus
            );

            await expect(
                toolManager.executeTool('mcp--file_read', { path: '/test' })
            ).rejects.toThrow('Confirmation failed');
        });
    });
});
