import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResourceManager } from './manager.js';
import { MCPManager } from '../mcp/manager.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedInternalResourcesConfig } from './schemas.js';
import { InternalResourcesProvider } from './internal-provider.js';

// Mock logger
vi.mock('../logger/index.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock internal provider
vi.mock('./internal-provider.js');

describe('ResourceManager - Unit Tests', () => {
    let mockMcpManager: MCPManager;
    let mockMcpClient: any;
    let resourceManager: ResourceManager;

    const mockReadResourceResult: ReadResourceResult = {
        contents: [
            {
                uri: 'file:///test1.txt',
                mimeType: 'text/plain',
                text: 'Test file content',
            },
        ],
        _meta: {},
    };

    beforeEach(() => {
        mockMcpClient = {
            listResources: vi.fn().mockResolvedValue(['file:///test1.txt', 'file:///test2.md']),
        };

        mockMcpManager = {
            getClients: vi.fn().mockReturnValue(
                new Map([
                    ['filesystem', mockMcpClient],
                    ['git', { listResources: vi.fn().mockResolvedValue(['git://repo.git']) }],
                ])
            ),
            readResource: vi.fn().mockResolvedValue(mockReadResourceResult),
            getResourceClient: vi.fn().mockReturnValue(mockMcpClient),
        } as any;

        resourceManager = new ResourceManager(mockMcpManager);
        vi.clearAllMocks();
    });

    describe('Basic Resource Operations', () => {
        it('should list all resources from MCP providers with clean URI format', async () => {
            const resources = await resourceManager.list();

            expect(Object.keys(resources)).toHaveLength(3); // 2 from filesystem + 1 from git
            expect(resources['mcp:filesystem:file:///test1.txt']).toBeDefined();
            expect(resources['mcp:filesystem:file:///test2.md']).toBeDefined();
            expect(resources['mcp:git:git://repo.git']).toBeDefined();

            // Check resource metadata format
            const resource1 = resources['mcp:filesystem:file:///test1.txt'];
            expect(resource1).toBeDefined();
            expect(resource1!.name).toBe('test1.txt');
            expect(resource1!.source).toBe('mcp');
            expect(resource1!.serverName).toBe('filesystem');
            expect(resource1!.metadata?.originalUri).toBe('file:///test1.txt');
        });

        it('should check if MCP resource exists', async () => {
            // Mock getResourceClient to return client for existing resource, undefined for non-existing
            mockMcpManager.getResourceClient = vi.fn((uri: string) => {
                if (uri === 'file:///test1.txt') return mockMcpClient;
                return undefined;
            });

            const exists1 = await resourceManager.has('mcp:filesystem:file:///test1.txt');
            const exists2 = await resourceManager.has('mcp:nonexistent:file:///fake.txt');

            expect(exists1).toBe(true);
            expect(exists2).toBe(false);
            expect(mockMcpManager.getResourceClient).toHaveBeenCalledWith('file:///test1.txt');
        });

        it('should read resource content for MCP resources', async () => {
            const content = await resourceManager.read('mcp:filesystem:file:///test1.txt');

            expect(content).toEqual(mockReadResourceResult);
            expect(mockMcpManager.readResource).toHaveBeenCalledWith('file:///test1.txt');
        });

        it('should throw error for invalid URI formats', async () => {
            await expect(resourceManager.read('invalid-format')).rejects.toThrow(
                'Invalid resource URI format: invalid-format'
            );
        });

        it('should handle MCP client errors gracefully during listing', async () => {
            mockMcpClient.listResources.mockRejectedValue(new Error('Client error'));

            const resources = await resourceManager.list();

            // Should still return resources from other working clients
            expect(Object.keys(resources)).toHaveLength(1); // Only git client works
            expect(resources['mcp:git:git://repo.git']).toBeDefined();
        });
    });

    describe('Internal Resources Integration', () => {
        let resourceManagerWithInternal: ResourceManager;
        let mockInternalProvider: any;

        beforeEach(() => {
            const mockInternalConfig: ValidatedInternalResourcesConfig = {
                enabled: true,
                resources: [{ type: 'filesystem', paths: ['.'] }],
            };

            mockInternalProvider = {
                initialize: vi.fn(),
                listResources: vi.fn().mockResolvedValue([
                    {
                        uri: 'fs:///local/file.js',
                        name: 'file.js',
                        description: 'Local file',
                        source: 'custom',
                    },
                ]),
                hasResource: vi.fn(),
                readResource: vi.fn().mockResolvedValue(mockReadResourceResult),
                refresh: vi.fn(),
            };

            vi.mocked(InternalResourcesProvider).mockImplementation(() => mockInternalProvider);

            resourceManagerWithInternal = new ResourceManager(mockMcpManager, {
                internalResourcesConfig: mockInternalConfig,
            });
        });

        it('should initialize with internal resources when enabled', async () => {
            await resourceManagerWithInternal.initialize();
            expect(mockInternalProvider.initialize).toHaveBeenCalled();
        });

        it('should list internal resources with proper prefixing', async () => {
            const resources = await resourceManagerWithInternal.list();

            // Should have MCP + internal resources
            expect(Object.keys(resources).length).toBeGreaterThan(3);
            expect(resources['internal:/local/file.js']).toBeDefined();

            const internalResource = resources['internal:/local/file.js'];
            expect(internalResource).toBeDefined();
            expect(internalResource!.name).toBe('file.js');
            expect(internalResource!.source).toBe('custom');
        });

        it('should read internal resource content', async () => {
            const content = await resourceManagerWithInternal.read('internal:/local/file.js');

            expect(content).toEqual(mockReadResourceResult);
            expect(mockInternalProvider.readResource).toHaveBeenCalledWith('fs:///local/file.js');
        });

        it('should check internal resource existence', async () => {
            mockInternalProvider.hasResource.mockResolvedValue(true);

            const exists = await resourceManagerWithInternal.has('internal:/local/file.js');

            expect(exists).toBe(true);
            expect(mockInternalProvider.hasResource).toHaveBeenCalledWith('fs:///local/file.js');
        });

        it('should throw error for internal resources when not initialized', async () => {
            await expect(resourceManager.read('internal:some/file.txt')).rejects.toThrow(
                'Internal resources not initialized for: internal:some/file.txt'
            );
        });
    });

    describe('Cache Management', () => {
        it('should refresh internal resources when requested', async () => {
            const mockInternalProvider = {
                initialize: vi.fn(),
                refresh: vi.fn(),
            } as any;

            vi.mocked(InternalResourcesProvider).mockImplementation(() => mockInternalProvider);

            const resourceManagerWithInternal = new ResourceManager(mockMcpManager, {
                internalResourcesConfig: {
                    enabled: true,
                    resources: [{ type: 'filesystem', paths: ['.'] }],
                },
            });

            await resourceManagerWithInternal.refresh();

            expect(mockInternalProvider.refresh).toHaveBeenCalled();
        });
    });

    describe('Direct Provider Access', () => {
        it('should provide access to internal resources provider when enabled', () => {
            const mockInternalProvider = { initialize: vi.fn() } as any;
            vi.mocked(InternalResourcesProvider).mockImplementation(() => mockInternalProvider);

            const resourceManagerWithInternal = new ResourceManager(mockMcpManager, {
                internalResourcesConfig: {
                    enabled: true,
                    resources: [{ type: 'filesystem', paths: ['.'] }],
                },
            });

            const internalProvider = resourceManagerWithInternal.getInternalResourcesProvider();
            expect(internalProvider).toBeDefined();
        });

        it('should return undefined for internal resources provider when disabled', () => {
            const internalProvider = resourceManager.getInternalResourcesProvider();
            expect(internalProvider).toBeUndefined();
        });
    });

    describe('URI Format Validation', () => {
        it('should parse MCP URIs correctly', async () => {
            const _content = await resourceManager.read('mcp:server:complex:uri:with:colons');

            expect(mockMcpManager.readResource).toHaveBeenCalledWith('complex:uri:with:colons');
        });

        it('should reject empty URI parts', async () => {
            await expect(resourceManager.read('mcp:server:')).rejects.toThrow(
                'Invalid MCP resource URI format: mcp:server:'
            );

            await expect(resourceManager.read('internal:')).rejects.toThrow(
                'Resource URI cannot be empty after prefix: internal:'
            );
        });
    });
});
