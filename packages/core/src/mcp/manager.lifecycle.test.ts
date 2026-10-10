import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPManager } from './manager.js';
import { DextoMcpClient } from './mcp-client.js';
import { MCPError } from './errors.js';
import { MCPErrorCode } from './error-codes.js';
import { McpServerConfigSchema } from './schemas.js';
import { AgentEventBus } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

afterEach(() => vi.restoreAllMocks());

describe('MCP failed candidate cleanup', () => {
    it('preserves the original connection failure and code when disconnect also rejects', async () => {
        const logger = createMockLogger();
        const manager = new MCPManager(logger, new AgentEventBus());
        const originalError = MCPError.protocolError('fixture original protocol failure');
        vi.spyOn(DextoMcpClient.prototype, 'connect').mockRejectedValueOnce(originalError);
        const disconnect = vi
            .spyOn(DextoMcpClient.prototype, 'disconnect')
            .mockRejectedValueOnce(new Error('fixture cleanup failed'));
        const config = McpServerConfigSchema.parse({
            type: 'stdio',
            command: 'unused-fixture-command',
        });
        await expect(manager.connectServer('fixture', config)).rejects.toMatchObject({
            code: MCPErrorCode.CONNECTION_FAILED,
            message: expect.stringContaining('fixture original protocol failure'),
        });
        expect(disconnect).toHaveBeenCalledOnce();
        expect(manager.getFailedConnectionError('fixture')).toBe(originalError.message);
        expect(manager.getFailedConnectionErrorCode('fixture')).toBe(MCPErrorCode.PROTOCOL_ERROR);
        expect(manager.getClients().size).toBe(0);
        expect(logger.warn).toHaveBeenCalledWith(
            "Failed to disconnect rejected MCP client 'fixture'"
        );
    });
});
