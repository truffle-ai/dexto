import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MCPManager } from './manager.js';
import { DextoMcpClient } from './mcp-client.js';
import { McpServerConfigSchema } from './schemas.js';
import type { MCPResolvedResource } from './types.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createMockLogger } from '../logger/v2/test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to resources-demo-server relative to this test file
const RESOURCES_DEMO_PATH = resolve(
    __dirname,
    '../../../../examples/resources-demo-server/server.js'
);
const MEMORY_DEMO_PATH = resolve(__dirname, '../../../../examples/memory-demo-server/server.js');

/**
 * Integration tests for MCPManager with real MCP servers
 *
 * These tests connect to actual MCP servers to verify:
 * - Real connection and caching behavior
 * - Tool/prompt/resource discovery
 * - Multi-server coordination
 * - Cache performance
 */

describe('MCPManager Integration Tests', () => {
    let manager: MCPManager;
    const mockLogger = createMockLogger();

    beforeEach(() => {
        manager = new MCPManager(mockLogger);
    });

    afterEach(async () => {
        await manager.disconnectAll();
    });

    describe('Resources Demo Server (Comprehensive)', () => {
        it('should connect to resources-demo server and cache resources', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'resources-demo');

            manager.registerClient('resources-demo', client);
            await manager.refresh();

            // Verify resources are cached
            const resources = await manager.listAllResources();
            expect(resources.length).toBeGreaterThan(0);

            console.log(
                'Resources Demo resources:',
                resources.map((r: MCPResolvedResource) => r.summary.uri)
            );
            expect(
                resources.some(
                    (r: MCPResolvedResource) => r.summary.uri?.includes('mcp-demo://') ?? false
                )
            ).toBe(true);

            // Verify second call uses cache
            const resourcesCached = await manager.listAllResources();
            expect(resourcesCached).toEqual(resources);
        }, 15000);

        it('should read resource content from resources-demo server', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'resources-demo');

            manager.registerClient('resources-demo', client);
            await manager.refresh();

            // Read a resource
            const content = await manager.readResource(
                'mcp:resources-demo:mcp-demo://product-metrics'
            );
            expect(content).toBeDefined();
            expect(content.contents).toBeDefined();
            expect(content.contents.length).toBeGreaterThan(0);

            const firstContent = content.contents[0];
            expect(firstContent).toBeDefined();

            console.log('Resource content type:', firstContent!.mimeType);
            expect(firstContent!.mimeType).toBe('application/json');
        }, 15000);

        it('should cache and retrieve prompts from resources-demo server', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'resources-demo');

            manager.registerClient('resources-demo', client);
            await manager.refresh();

            // Verify prompts are cached
            const prompts = manager.getAllPromptMetadata();
            expect(prompts.length).toBeGreaterThan(0);

            console.log(
                'Resources Demo prompts:',
                prompts.map((p) => p.promptName)
            );
            expect(prompts.some((p) => p.promptName === 'analyze-metrics')).toBe(true);
            expect(prompts.some((p) => p.promptName === 'generate-report')).toBe(true);

            // Verify second call uses cache
            const promptsCached = manager.getAllPromptMetadata();
            expect(promptsCached).toEqual(prompts);
        }, 15000);

        it('should retrieve and execute prompts with arguments', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'resources-demo');

            manager.registerClient('resources-demo', client);
            await manager.refresh();

            // Get a prompt with arguments
            const promptResult = await manager.getPrompt('analyze-metrics', {
                metric_type: 'revenue',
                time_period: 'Q1 2025',
            });

            expect(promptResult).toBeDefined();
            expect(promptResult.messages).toBeDefined();
            expect(promptResult.messages.length).toBeGreaterThan(0);

            const firstMessage = promptResult.messages[0];
            expect(firstMessage).toBeDefined();

            console.log('Prompt message role:', firstMessage!.role);
            expect(firstMessage!.role).toBe('user');
        }, 15000);

        it('should cache and discover tools from resources-demo server', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'resources-demo');

            manager.registerClient('resources-demo', client);
            await manager.refresh();

            // Verify tools are cached
            const tools = await manager.getAllTools();
            const toolNames = Object.keys(tools);

            console.log('Resources Demo tools:', toolNames);
            expect(toolNames.length).toBeGreaterThan(0);
            expect(toolNames.some((name) => name.includes('calculate-growth-rate'))).toBe(true);
            expect(toolNames.some((name) => name.includes('format-metric'))).toBe(true);

            // Verify tool schema - tools have 'parameters' field (converted from inputSchema)
            const growthRateTool = tools['calculate-growth-rate'];
            expect(
                growthRateTool,
                `Tool calculate-growth-rate should exist.\nAvailable tools: ${JSON.stringify(tools, null, 2)}`
            ).toBeDefined();

            console.log('Growth rate tool has parameters:', !!growthRateTool!.parameters);
            expect(growthRateTool!.parameters).toBeDefined();
            expect(growthRateTool!.parameters.type).toBe('object');
            expect(growthRateTool!.parameters.properties).toBeDefined();
        }, 15000);

        it('should have all three capabilities: resources, prompts, and tools', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'resources-demo');

            manager.registerClient('resources-demo', client);
            await manager.refresh();

            // Check all three capabilities
            const resources = await manager.listAllResources();
            const prompts = manager.getAllPromptMetadata();
            const tools = await manager.getAllTools();

            console.log(
                'Summary: Resources:',
                resources.length,
                'Prompts:',
                prompts.length,
                'Tools:',
                Object.keys(tools).length
            );

            expect(resources.length).toBeGreaterThan(0);
            expect(prompts.length).toBeGreaterThan(0);
            expect(Object.keys(tools).length).toBeGreaterThan(0);
        }, 15000);
    });

    describe('Memory MCP Server', () => {
        it('should connect to memory server and cache tools', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [MEMORY_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'memory');

            manager.registerClient('memory', client);
            await manager.refresh();

            // Verify tools are cached
            const tools = await manager.getAllTools();
            expect(Object.keys(tools).length).toBeGreaterThan(0);

            // Memory server should have memory-related tools
            const toolNames = Object.keys(tools);
            console.log('Memory server tools:', toolNames);
            expect(
                toolNames.some((name) => name.includes('memory') || name.includes('entities'))
            ).toBe(true);
        }, 15000);
    });

    describe('Multi-Server Integration', () => {
        it('should handle two different servers with separate caches', async () => {
            // Connect resources-demo server
            const resourcesConfig = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const resourcesClient = new DextoMcpClient(mockLogger);
            await resourcesClient.connect(resourcesConfig, 'resources-demo');

            // Connect memory server
            const memoryConfig = McpServerConfigSchema.parse({
                command: 'node',
                args: [MEMORY_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const memoryClient = new DextoMcpClient(mockLogger);
            await memoryClient.connect(memoryConfig, 'memory');

            // Register both
            manager.registerClient('resources-demo', resourcesClient);
            manager.registerClient('memory', memoryClient);

            await manager.refresh();

            // Verify both servers' resources/tools are available
            const resources = await manager.listAllResources();
            const tools = await manager.getAllTools();

            console.log('Resources from both servers:', resources.length);
            console.log('Tools from both servers:', Object.keys(tools).length);

            // Should have resources from resources-demo
            expect(resources.length).toBeGreaterThan(0);
            // Should have tools from memory server
            expect(Object.keys(tools).length).toBeGreaterThan(0);
        }, 20000);

        it('should cleanup one server without affecting the other', async () => {
            // Connect both servers
            const resourcesConfig = McpServerConfigSchema.parse({
                command: 'node',
                args: [RESOURCES_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const resourcesClient = new DextoMcpClient(mockLogger);
            await resourcesClient.connect(resourcesConfig, 'resources-demo');

            const memoryConfig = McpServerConfigSchema.parse({
                command: 'node',
                args: [MEMORY_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const memoryClient = new DextoMcpClient(mockLogger);
            await memoryClient.connect(memoryConfig, 'memory');

            manager.registerClient('resources-demo', resourcesClient);
            manager.registerClient('memory', memoryClient);

            await manager.refresh();

            const toolsBefore = Object.keys(await manager.getAllTools()).length;

            // Remove resources-demo
            await manager.removeClient('resources-demo');

            const resourcesAfter = (await manager.listAllResources()).length;
            const toolsAfter = Object.keys(await manager.getAllTools()).length;

            // Should have no resources now (resources-demo was removed)
            expect(resourcesAfter).toBe(0);

            // Should still have memory server tools
            expect(toolsAfter).toBeGreaterThan(0);
            // Tool count decreased because resources-demo had tools that were removed
            expect(toolsAfter).toBeLessThan(toolsBefore);
        }, 20000);
    });

    describe('Cache Performance', () => {
        it('should demonstrate caching eliminates network calls', async () => {
            const config = McpServerConfigSchema.parse({
                command: 'node',
                args: [MEMORY_DEMO_PATH],
                type: 'stdio',
                env: {},
            });

            const client = new DextoMcpClient(mockLogger);
            await client.connect(config, 'memory');

            manager.registerClient('memory', client);

            // Time first call (populates cache)
            const start1 = Date.now();
            await manager.refresh();
            const firstCall = await manager.getAllTools();
            const time1 = Date.now() - start1;

            // Time second call (from cache)
            const start2 = Date.now();
            const secondCall = await manager.getAllTools();
            const time2 = Date.now() - start2;

            // Verify same tools returned
            expect(secondCall).toEqual(firstCall);

            // Cache should be faster (relaxed from time1/2 to avoid flakes under load)
            console.log(
                `First call (with cache): ${time1}ms, Second call (from cache): ${time2}ms`
            );
            expect(time2).toBeLessThan(time1);
        }, 20000);
    });
});
