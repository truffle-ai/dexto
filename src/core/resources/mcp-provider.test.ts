import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPResourceProvider } from './mcp-provider.js';
import { MCPManager } from '../mcp/manager.js';
import type { IMCPClient } from '../mcp/types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// Mock logger
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('MCPResourceProvider - Unit Tests', () => {
    let mockMcpManager: MCPManager;
    let mcpResourceProvider: MCPResourceProvider;
    let mockClient1: IMCPClient;
    let mockClient2: IMCPClient;

    const mockReadResourceResult: ReadResourceResult = {
        contents: [
            {
                uri: 'file:///test.txt',
                mimeType: 'text/plain',
                text: 'Test file content',
            },
        ],
        _meta: {},
    };

    beforeEach(() => {
        mockClient1 = {
            listResources: vi
                .fn()
                .mockResolvedValue(['file:///document1.txt', 'file:///document2.pdf']),
            readResource: vi.fn().mockResolvedValue(mockReadResourceResult),
        } as any;

        mockClient2 = {
            listResources: vi.fn().mockResolvedValue(['http://example.com/api/data']),
            readResource: vi.fn().mockResolvedValue(mockReadResourceResult),
        } as any;

        mockMcpManager = {
            getClients: vi.fn().mockReturnValue(
                new Map([
                    ['filesystem', mockClient1],
                    ['web-api', mockClient2],
                ])
            ),
            getResourceClient: vi.fn(),
            readResource: vi.fn().mockResolvedValue(mockReadResourceResult),
        } as any;

        mcpResourceProvider = new MCPResourceProvider(mockMcpManager);
        vi.clearAllMocks();
    });

    describe('Resource Discovery', () => {
        it('should list resources from all connected MCP servers', async () => {
            const resources = await mcpResourceProvider.listResources();

            expect(resources).toHaveLength(3);

            // Check filesystem resources
            expect(
                resources.find((r) => r.uri === 'mcp--filesystem--file:///document1.txt')
            ).toBeDefined();
            expect(
                resources.find((r) => r.uri === 'mcp--filesystem--file:///document2.pdf')
            ).toBeDefined();

            // Check web-api resources
            expect(
                resources.find((r) => r.uri === 'mcp--web-api--http://example.com/api/data')
            ).toBeDefined();
        });

        it('should handle server errors gracefully during resource listing', async () => {
            // Mock one server to fail
            mockClient1.listResources = vi.fn().mockRejectedValue(new Error('Server error'));

            const resources = await mcpResourceProvider.listResources();

            // Should still get resources from the working server
            expect(resources).toHaveLength(1);
            expect(resources[0]?.serverName).toBe('web-api');
        });

        it('should cache resources and not rebuild unnecessarily', async () => {
            // First call
            await mcpResourceProvider.listResources();
            expect(mockClient1.listResources).toHaveBeenCalledTimes(1);
            expect(mockClient2.listResources).toHaveBeenCalledTimes(1);

            // Second call should use cache
            await mcpResourceProvider.listResources();
            expect(mockClient1.listResources).toHaveBeenCalledTimes(1);
            expect(mockClient2.listResources).toHaveBeenCalledTimes(1);
        });

        it('should rebuild cache when invalidated', async () => {
            // First call
            await mcpResourceProvider.listResources();
            expect(mockClient1.listResources).toHaveBeenCalledTimes(1);

            // Invalidate cache
            mcpResourceProvider.invalidateCache();

            // Second call should rebuild
            await mcpResourceProvider.listResources();
            expect(mockClient1.listResources).toHaveBeenCalledTimes(2);
        });
    });

    describe('Resource Metadata', () => {
        it('should create proper metadata for MCP resources', async () => {
            const resources = await mcpResourceProvider.listResources();
            const txtResource = resources.find((r) => r.name === 'document1.txt');

            expect(txtResource).toBeDefined();
            expect(txtResource!).toMatchObject({
                uri: 'mcp--filesystem--file:///document1.txt',
                name: 'document1.txt',
                description: 'Resource from MCP server: filesystem',
                source: 'mcp',
                serverName: 'filesystem',
                metadata: {
                    originalUri: 'file:///document1.txt',
                    serverName: 'filesystem',
                },
            });
        });

        it('should extract names from various URI patterns', async () => {
            // Test different URI patterns
            mockClient1.listResources = vi.fn().mockResolvedValue([
                'file:///path/to/document.txt', // Unix-style path
                'file:///C:\\Windows\\file.exe', // Windows-style path
                'http://example.com/api/data', // URL
                'simple-name', // Simple name
            ]);

            const resources = await mcpResourceProvider.listResources();

            expect(resources.find((r) => r.name === 'document.txt')).toBeDefined();
            expect(resources.find((r) => r.name === 'file.exe')).toBeDefined();
            expect(resources.find((r) => r.name === 'data')).toBeDefined();
            expect(resources.find((r) => r.name === 'simple-name')).toBeDefined();
        });
    });

    describe('Resource Content Reading', () => {
        it('should read resource content by parsing qualified URI', async () => {
            const qualifiedUri = 'mcp--filesystem--file:///test.txt';

            const content = await mcpResourceProvider.readResource(qualifiedUri);

            expect(mockMcpManager.readResource).toHaveBeenCalledWith('file:///test.txt');
            expect(content).toEqual(mockReadResourceResult);
        });

        it('should throw error for invalid URI format', async () => {
            const invalidUri = 'invalid-uri-format';

            await expect(mcpResourceProvider.readResource(invalidUri)).rejects.toThrow(
                'Invalid MCP resource URI format: invalid-uri-format'
            );
        });

        it('should throw error for non-MCP URI format', async () => {
            const nonMcpUri = 'custom--provider--resource';

            await expect(mcpResourceProvider.readResource(nonMcpUri)).rejects.toThrow(
                'Invalid MCP resource URI format: custom--provider--resource'
            );
        });
    });

    describe('Resource Existence Check', () => {
        it('should check resource existence through MCP manager', async () => {
            const qualifiedUri = 'mcp--filesystem--file:///test.txt';
            mockMcpManager.getResourceClient = vi.fn().mockReturnValue(mockClient1);

            const exists = await mcpResourceProvider.hasResource(qualifiedUri);

            expect(exists).toBe(true);
        });

        it('should return false for non-existent resources', async () => {
            const qualifiedUri = 'mcp--filesystem--file:///non-existent.txt';
            mockMcpManager.getResourceClient = vi.fn().mockReturnValue(undefined);

            const exists = await mcpResourceProvider.hasResource(qualifiedUri);

            expect(exists).toBe(false);
        });

        it('should return false for invalid URI format', async () => {
            const invalidUri = 'invalid-format';

            const exists = await mcpResourceProvider.hasResource(invalidUri);

            expect(exists).toBe(false);
        });
    });

    describe('Cache Management', () => {
        it('should get cached metadata after initial build', async () => {
            // Build cache first
            await mcpResourceProvider.listResources();

            const metadata = await mcpResourceProvider.getResourceMetadata(
                'mcp--filesystem--file:///document1.txt'
            );

            expect(metadata).toBeDefined();
            expect(metadata?.name).toBe('document1.txt');
            expect(metadata?.serverName).toBe('filesystem');
        });

        it('should refresh cache and rebuild', async () => {
            // Initial build
            await mcpResourceProvider.listResources();
            expect(mockClient1.listResources).toHaveBeenCalledTimes(1);

            // Refresh should rebuild
            await mcpResourceProvider.refresh();
            expect(mockClient1.listResources).toHaveBeenCalledTimes(2);
        });
    });

    describe('Source Type', () => {
        it('should return correct source type', () => {
            expect(mcpResourceProvider.getSource()).toBe('mcp');
        });
    });
});
