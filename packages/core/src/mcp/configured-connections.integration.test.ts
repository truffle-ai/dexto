import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../logger/v2/test-utils.js';
import { ConfiguredMCPConnections } from './configured-connections.js';
import { MCPManager } from './manager.js';
import { McpServerConfigSchema, ServersConfigSchema } from './schemas.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const resourcesDemoPath = resolve(
    testDirectory,
    '../../../../examples/resources-demo-server/server.js'
);

describe('ConfiguredMCPConnections integration', () => {
    const logger = createMockLogger();
    const connections = new ConfiguredMCPConnections(logger);
    const manager = new MCPManager(connections, logger);

    afterEach(async () => {
        await manager.close();
    });

    it('keeps Core/CLI stdio lifecycle outside MCPManager while refreshing its catalog', async () => {
        await manager.initialize();
        const config = McpServerConfigSchema.parse({
            command: 'node',
            args: [resourcesDemoPath],
            type: 'stdio',
            env: {},
        });

        await connections.connect('resources-demo', config);

        expect(manager.getToolDescriptors().map((tool) => tool.name)).toEqual([
            'calculate-growth-rate',
            'format-metric',
        ]);
        expect(await manager.listAllPrompts()).toContain('analyze-metrics');
        expect(await manager.listAllResources()).toHaveLength(3);

        await connections.restart('resources-demo');
        expect(manager.getToolDescriptor('calculate-growth-rate')?.identity).toEqual({
            type: 'mcp',
            connectionId: 'resources-demo',
            toolName: 'calculate-growth-rate',
        });

        await connections.remove('resources-demo');
        expect(manager.getToolDescriptors()).toEqual([]);
    }, 20_000);

    it('rolls back a connected transport when catalog installation rejects it', async () => {
        const rejectedConnections = new ConfiguredMCPConnections(logger);
        const stopRejectingCatalogs = rejectedConnections.onChange(() => {
            throw new Error('catalog rejected');
        });
        const config = McpServerConfigSchema.parse({
            command: 'node',
            args: [resourcesDemoPath],
            type: 'stdio',
            env: {},
        });

        await expect(rejectedConnections.connect('resources-demo', config)).rejects.toThrow(
            'catalog rejected'
        );
        expect(await rejectedConnections.listConnections()).toEqual([]);
        expect(rejectedConnections.getClients()).toEqual(new Map());
        stopRejectingCatalogs();
        await rejectedConnections.close();
    }, 20_000);

    it('keeps lenient startup failures inspectable and closes successful peers on strict failure', async () => {
        const lenientConnections = new ConfiguredMCPConnections(logger);
        const missingCommand = McpServerConfigSchema.parse({
            command: '__missing_dexto_mcp_command__',
            type: 'stdio',
            env: {},
        });
        await lenientConnections.initializeFromConfig(
            ServersConfigSchema.parse({ broken: missingCommand })
        );
        expect(lenientConnections.getFailures().broken?.message).toBeDefined();
        await lenientConnections.close();

        const strictConnections = new ConfiguredMCPConnections(logger);
        const listener = vi.fn();
        strictConnections.onChange(listener);
        await expect(
            strictConnections.initializeFromConfig(
                ServersConfigSchema.parse({
                    healthy: McpServerConfigSchema.parse({
                        command: 'node',
                        args: [resourcesDemoPath],
                        type: 'stdio',
                        env: {},
                    }),
                    broken: McpServerConfigSchema.parse({
                        command: '__missing_dexto_mcp_command__',
                        type: 'stdio',
                        connectionMode: 'strict',
                        env: {},
                    }),
                })
            )
        ).rejects.toThrow('strict servers');
        expect(await strictConnections.listConnections()).toEqual([]);
        expect(strictConnections.getClients()).toEqual(new Map());
        expect(listener).toHaveBeenCalled();
    }, 20_000);
});
