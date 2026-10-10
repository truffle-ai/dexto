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

describe('MCP displaced client ownership', () => {
    it('disconnects repeated current and retired identities once per cleanup pass', async () => {
        const logger = createMockLogger();
        const manager = new MCPManager(logger, new AgentEventBus());
        const first = new DextoMcpClient(logger);
        const second = new DextoMcpClient(logger);
        const firstClose = vi.spyOn(first, 'disconnect').mockResolvedValue();
        const secondClose = vi.spyOn(second, 'disconnect').mockResolvedValue();
        manager.registerClient('shared', first);
        manager.registerClient('shared', first);
        manager.registerClient('shared', second);
        manager.registerClient('shared', first);
        manager.registerClient('alias', first);
        expect(firstClose).not.toHaveBeenCalled();
        expect(secondClose).not.toHaveBeenCalled();
        expect(manager.getClients().get('shared')).toBe(first);
        await manager.disconnectAll();
        expect(firstClose).toHaveBeenCalledOnce();
        expect(secondClose).toHaveBeenCalledOnce();
        expect(manager.getClients().size).toBe(0);
        await manager.disconnectAll();
        expect(firstClose).toHaveBeenCalledOnce();
        expect(secondClose).toHaveBeenCalledOnce();
    });
    it('attempts every current and displaced identity when one disconnect rejects', async () => {
        const logger = createMockLogger();
        const manager = new MCPManager(logger, new AgentEventBus());
        const first = new DextoMcpClient(logger);
        const second = new DextoMcpClient(logger);
        const third = new DextoMcpClient(logger);
        const firstClose = vi
            .spyOn(first, 'disconnect')
            .mockRejectedValue(MCPError.protocolError('fixture close rejected'));
        const secondClose = vi.spyOn(second, 'disconnect').mockResolvedValue();
        const thirdClose = vi.spyOn(third, 'disconnect').mockResolvedValue();
        manager.registerClient('shared', first);
        manager.registerClient('shared', second);
        manager.registerClient('shared', third);
        await manager.disconnectAll();
        expect(firstClose).toHaveBeenCalledOnce();
        expect(secondClose).toHaveBeenCalledOnce();
        expect(thirdClose).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith("Failed to disconnect client 'shared'", {
            code: MCPErrorCode.DISCONNECTION_FAILED,
        });
        expect(manager.getClients().size).toBe(0);
        await manager.disconnectAll();
        expect(firstClose).toHaveBeenCalledOnce();
        expect(secondClose).toHaveBeenCalledOnce();
        expect(thirdClose).toHaveBeenCalledOnce();
    });
});
