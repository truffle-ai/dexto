import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResourceManager } from './resource-manager.js';
import { MCPManager } from '../mcp/manager.js';
import type { ResourceProvider, ResourceMetadata } from './types.js';
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

describe('ResourceManager - Unit Tests', () => {
    let mockMcpManager: MCPManager;
    let resourceManager: ResourceManager;

    const mockMcpResourceMetadata: ResourceMetadata[] = [
        {
            uri: 'mcp--filesystem--file:///test1.txt',
            name: 'test1.txt',
            description: 'Resource from MCP server: filesystem',
            source: 'mcp',
            serverName: 'filesystem',
            mimeType: 'text/plain',
            metadata: {
                originalUri: 'file:///test1.txt',
                serverName: 'filesystem',
            },
        },
        {
            uri: 'mcp--filesystem--file:///test2.json',
            name: 'test2.json',
            description: 'Resource from MCP server: filesystem',
            source: 'mcp',
            serverName: 'filesystem',
            mimeType: 'application/json',
            metadata: {
                originalUri: 'file:///test2.json',
                serverName: 'filesystem',
            },
        },
    ];

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
        mockMcpManager = {
            getClients: vi
                .fn()
                .mockReturnValue(new Map([['filesystem', { listResources: vi.fn() }]])),
            readResource: vi.fn(),
        } as any;

        resourceManager = new ResourceManager(mockMcpManager);
        vi.clearAllMocks();
    });

    describe('Resource Querying', () => {
        beforeEach(async () => {
            // Mock the MCP resource provider to return test data
            vi.spyOn(resourceManager['mcpResourceProvider'], 'listResources').mockResolvedValue(
                mockMcpResourceMetadata
            );
        });

        it('should return all resources from MCP providers', async () => {
            const resources = await resourceManager.getAllResources();

            expect(Object.keys(resources)).toHaveLength(2);
            expect(resources['mcp--filesystem--file:///test1.txt']).toBeDefined();
            expect(resources['mcp--filesystem--file:///test2.json']).toBeDefined();
        });

        it('should get resource metadata by URI', async () => {
            const metadata = await resourceManager.getResourceMetadata(
                'mcp--filesystem--file:///test1.txt'
            );

            expect(metadata).toBeDefined();
            expect(metadata!.uri).toBe('mcp--filesystem--file:///test1.txt');
            expect(metadata!.name).toBe('test1.txt');
            expect(metadata!.source).toBe('mcp');
            expect(metadata!.serverName).toBe('filesystem');
        });

        it('should return undefined for non-existent resource metadata', async () => {
            const metadata = await resourceManager.getResourceMetadata('non-existent-uri');
            expect(metadata).toBeUndefined();
        });

        it('should check if resource exists', async () => {
            const exists1 = await resourceManager.hasResource('mcp--filesystem--file:///test1.txt');
            const exists2 = await resourceManager.hasResource('non-existent-uri');

            expect(exists1).toBe(true);
            expect(exists2).toBe(false);
        });

        it('should query resources with filters', async () => {
            const result = await resourceManager.queryResources({
                filters: {
                    source: 'mcp',
                    serverName: 'filesystem',
                    mimeType: 'text/plain',
                },
            });

            expect(result.resources).toHaveLength(1);
            expect(result.resources[0].metadata.uri).toBe('mcp--filesystem--file:///test1.txt');
            expect(result.total).toBe(1);
            expect(result.hasMore).toBe(false);
        });

        it('should query resources with search filter', async () => {
            const result = await resourceManager.queryResources({
                filters: {
                    search: 'json',
                },
            });

            expect(result.resources).toHaveLength(1);
            expect(result.resources[0].metadata.name).toBe('test2.json');
        });

        it('should apply limit to query results', async () => {
            const result = await resourceManager.queryResources({
                filters: {
                    limit: 1,
                },
            });

            expect(result.resources).toHaveLength(1);
            expect(result.total).toBe(2);
            expect(result.hasMore).toBe(true);
        });
    });

    describe('Resource Content Reading', () => {
        beforeEach(async () => {
            vi.spyOn(resourceManager['mcpResourceProvider'], 'listResources').mockResolvedValue(
                mockMcpResourceMetadata
            );
            vi.spyOn(resourceManager['mcpResourceProvider'], 'readResource').mockResolvedValue(
                mockReadResourceResult
            );
        });

        it('should read resource content for MCP resources', async () => {
            const content = await resourceManager.readResource(
                'mcp--filesystem--file:///test1.txt'
            );

            expect(content).toEqual(mockReadResourceResult);
            expect(resourceManager['mcpResourceProvider'].readResource).toHaveBeenCalledWith(
                'mcp--filesystem--file:///test1.txt'
            );
        });

        it('should throw error for non-existent resources', async () => {
            await expect(resourceManager.readResource('non-existent-uri')).rejects.toThrow(
                'Resource not found: non-existent-uri'
            );
        });
    });

    describe('Custom Resource Providers', () => {
        let mockCustomProvider: ResourceProvider;

        beforeEach(() => {
            mockCustomProvider = {
                listResources: vi.fn().mockResolvedValue([
                    {
                        uri: 'custom://test-resource',
                        name: 'Custom Resource',
                        description: 'A custom resource',
                        source: 'custom',
                    },
                ]),
                readResource: vi.fn().mockResolvedValue({
                    contents: [{ text: 'Custom content' }],
                    _meta: {},
                }),
                hasResource: vi.fn().mockResolvedValue(true),
                getSource: vi.fn().mockReturnValue('custom'),
            } as ResourceProvider;

            vi.spyOn(resourceManager['mcpResourceProvider'], 'listResources').mockResolvedValue([]);
        });

        it('should register and use custom resource providers', async () => {
            resourceManager.registerProvider('test-provider', mockCustomProvider);

            const resources = await resourceManager.getAllResources();
            expect(Object.keys(resources)).toContain(
                'custom--test-provider--custom://test-resource'
            );

            const qualifiedUri = 'custom--test-provider--custom://test-resource';
            const metadata = await resourceManager.getResourceMetadata(qualifiedUri);
            expect(metadata!.name).toBe('Custom Resource');
            expect(metadata!.metadata?.originalUri).toBe('custom://test-resource');
            expect(metadata!.metadata?.providerName).toBe('test-provider');
        });

        it('should unregister custom resource providers', async () => {
            resourceManager.registerProvider('test-provider', mockCustomProvider);
            resourceManager.unregisterProvider('test-provider');

            const resources = await resourceManager.getAllResources();
            expect(Object.keys(resources)).not.toContain(
                'custom--test-provider--custom://test-resource'
            );
        });

        it('should read content from custom providers', async () => {
            resourceManager.registerProvider('test-provider', mockCustomProvider);

            // First get the resource to populate cache
            await resourceManager.getAllResources();

            const qualifiedUri = 'custom--test-provider--custom://test-resource';
            const content = await resourceManager.readResource(qualifiedUri);

            expect(mockCustomProvider.readResource).toHaveBeenCalledWith('custom://test-resource');
            expect(content).toEqual({
                contents: [{ text: 'Custom content' }],
                _meta: {},
            });
        });
    });

    describe('Resource Statistics', () => {
        beforeEach(async () => {
            const mcpResources: ResourceMetadata[] = [
                { ...mockMcpResourceMetadata[0] },
                { ...mockMcpResourceMetadata[1] },
            ];

            vi.spyOn(resourceManager['mcpResourceProvider'], 'listResources').mockResolvedValue(
                mcpResources
            );
        });

        it('should provide accurate resource statistics', async () => {
            const stats = await resourceManager.getResourceStats();

            expect(stats).toEqual({
                total: 2,
                mcp: 2,
                plugin: 0,
                custom: 0,
                byServer: {
                    filesystem: 2,
                },
            });
        });

        it('should include custom providers in statistics', async () => {
            const mockCustomProvider: ResourceProvider = {
                listResources: vi.fn().mockResolvedValue([
                    {
                        uri: 'plugin://test',
                        name: 'Plugin Resource',
                        source: 'plugin' as const,
                    },
                ]),
                readResource: vi.fn(),
                hasResource: vi.fn(),
                getSource: vi.fn().mockReturnValue('plugin'),
            };

            resourceManager.registerProvider('plugin-provider', mockCustomProvider);

            const stats = await resourceManager.getResourceStats();

            expect(stats.total).toBe(3);
            expect(stats.mcp).toBe(2);
            expect(stats.plugin).toBe(1);
        });
    });

    describe('Cache Management', () => {
        it('should invalidate and rebuild cache on provider changes', async () => {
            // Initial call to build cache
            const resources1 = await resourceManager.getAllResources();
            const initialCount = Object.keys(resources1).length;

            // Add a custom provider
            const mockProvider: ResourceProvider = {
                listResources: vi
                    .fn()
                    .mockResolvedValue([
                        { uri: 'new://resource', name: 'New', source: 'custom' as const },
                    ]),
                readResource: vi.fn(),
                hasResource: vi.fn(),
                getSource: vi.fn().mockReturnValue('custom'),
            };

            resourceManager.registerProvider('new-provider', mockProvider);

            // Cache should be invalidated and rebuilt
            const resources2 = await resourceManager.getAllResources();
            expect(Object.keys(resources2).length).toBeGreaterThan(initialCount);
        });

        it('should refresh cache when explicitly requested', async () => {
            const spy = vi
                .spyOn(resourceManager['mcpResourceProvider'], 'listResources')
                .mockResolvedValue([]);

            await resourceManager.refresh();

            expect(spy).toHaveBeenCalledTimes(1);
        });
    });
});
