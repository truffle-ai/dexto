import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResourceManager } from './manager.js';
import { MCPManager } from '../mcp/manager.js';
import type { ResourceMetadata } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedInternalResourcesConfig } from './schemas.js';

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

    describe('Basic Resource Operations', () => {
        beforeEach(async () => {
            // Mock the MCP resource provider to return test data
            vi.spyOn(resourceManager['mcpResourceProvider'], 'listResources').mockResolvedValue(
                mockMcpResourceMetadata
            );
        });

        it('should list all resources from MCP providers', async () => {
            const resources = await resourceManager.list();

            expect(Object.keys(resources)).toHaveLength(1);
            expect(resources['mcp--filesystem--file:///test1.txt']).toBeDefined();
        });

        it('should check if resource exists', async () => {
            const exists1 = await resourceManager.has('mcp--filesystem--file:///test1.txt');
            const exists2 = await resourceManager.has('non-existent-uri');

            expect(exists1).toBe(true);
            expect(exists2).toBe(false);
        });

        it('should read resource content for MCP resources', async () => {
            vi.spyOn(resourceManager['mcpResourceProvider'], 'readResource').mockResolvedValue(
                mockReadResourceResult
            );

            const content = await resourceManager.read('mcp--filesystem--file:///test1.txt');

            expect(content).toEqual(mockReadResourceResult);
            expect(resourceManager['mcpResourceProvider'].readResource).toHaveBeenCalledWith(
                'mcp--filesystem--file:///test1.txt'
            );
        });

        it('should throw error for resources without proper prefix', async () => {
            await expect(resourceManager.read('no-prefix-resource')).rejects.toThrow(
                'Resource not found: no-prefix-resource'
            );
        });
    });

    describe('Internal Resources Integration', () => {
        let resourceManagerWithInternal: ResourceManager;

        const internalResourcesConfig: ValidatedInternalResourcesConfig = {
            enabled: true,
            resources: [
                {
                    type: 'filesystem',
                    paths: ['/test/path'],
                },
            ],
        };

        beforeEach(() => {
            resourceManagerWithInternal = new ResourceManager(mockMcpManager, {
                internalResourcesConfig,
            });

            // Mock internal resources provider
            const mockInternalResources = [
                {
                    uri: 'fs:///test/path/file1.txt',
                    name: 'file1.txt',
                    description: 'File: /test/path/file1.txt',
                    source: 'custom' as const,
                    mimeType: 'text/plain',
                },
            ];

            vi.spyOn(
                resourceManagerWithInternal['mcpResourceProvider'],
                'listResources'
            ).mockResolvedValue([]);

            // Mock the internal resources provider if it exists
            if (resourceManagerWithInternal['internalResourcesProvider']) {
                vi.spyOn(
                    resourceManagerWithInternal['internalResourcesProvider'],
                    'listResources'
                ).mockResolvedValue(mockInternalResources);
                vi.spyOn(
                    resourceManagerWithInternal['internalResourcesProvider'],
                    'readResource'
                ).mockResolvedValue({
                    contents: [
                        {
                            uri: 'fs:///test/path/file1.txt',
                            mimeType: 'text/plain',
                            text: 'Internal file content',
                        },
                    ],
                    _meta: {},
                });
            }
        });

        it('should initialize without internal resources when disabled', () => {
            const manager = new ResourceManager(mockMcpManager, {
                internalResourcesConfig: { enabled: false, resources: [] },
            });
            expect(manager.getInternalResourcesProvider()).toBeUndefined();
        });

        it('should initialize with internal resources when enabled', () => {
            expect(resourceManagerWithInternal.getInternalResourcesProvider()).toBeDefined();
        });

        it('should list internal resources with proper prefixing', async () => {
            if (!resourceManagerWithInternal['internalResourcesProvider']) {
                return; // Skip if internal resources not initialized
            }

            const resources = await resourceManagerWithInternal.list();
            expect(resources['internal--fs:///test/path/file1.txt']).toBeDefined();
            expect(resources['internal--fs:///test/path/file1.txt']?.description).toContain(
                '(internal resource)'
            );
        });

        it('should read internal resource content', async () => {
            if (!resourceManagerWithInternal['internalResourcesProvider']) {
                return; // Skip if internal resources not initialized
            }

            const content = await resourceManagerWithInternal.read(
                'internal--fs:///test/path/file1.txt'
            );
            expect(content.contents[0]?.text).toBe('Internal file content');
        });

        it('should throw error for internal resources when not initialized', async () => {
            await expect(
                resourceManager.read('internal--fs:///test/path/file1.txt')
            ).rejects.toThrow('Internal resources not initialized');
        });
    });

    describe('Cache Management', () => {
        it('should refresh cache when explicitly requested', async () => {
            const spy = vi
                .spyOn(resourceManager['mcpResourceProvider'], 'listResources')
                .mockResolvedValue([]);

            await resourceManager.refresh();

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('should invalidate cache when resources are refreshed', async () => {
            const resourceManagerWithInternal = new ResourceManager(mockMcpManager, {
                internalResourcesConfig: { enabled: true, resources: [] },
            });

            if (resourceManagerWithInternal['internalResourcesProvider']) {
                const refreshSpy = vi
                    .spyOn(resourceManagerWithInternal['internalResourcesProvider'], 'refresh')
                    .mockResolvedValue();

                await resourceManagerWithInternal.refresh();

                expect(refreshSpy).toHaveBeenCalled();
            }
        });
    });

    describe('Direct Provider Access', () => {
        it('should provide access to MCP resource provider', () => {
            const mcpProvider = resourceManager.getMcpResourceProvider();
            expect(mcpProvider).toBeDefined();
        });

        it('should provide access to internal resources provider when enabled', () => {
            const resourceManagerWithInternal = new ResourceManager(mockMcpManager, {
                internalResourcesConfig: { enabled: true, resources: [] },
            });

            const internalProvider = resourceManagerWithInternal.getInternalResourcesProvider();
            expect(internalProvider).toBeDefined();
        });

        it('should return undefined for internal resources provider when disabled', () => {
            const internalProvider = resourceManager.getInternalResourcesProvider();
            expect(internalProvider).toBeUndefined();
        });
    });
});
