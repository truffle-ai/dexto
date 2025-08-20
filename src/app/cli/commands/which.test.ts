import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleWhichCommand } from './which.js';

// Mock dependencies
vi.mock('@core/config/agent-resolver.js');
vi.mock('chalk', () => ({
    default: {
        red: vi.fn((text: string) => text),
    },
}));

describe('handleWhichCommand', () => {
    let mockResolveAgentPath: any;
    let mockConsoleLog: any;
    let mockConsoleError: any;
    let mockProcessExit: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const agentResolver = await import('@core/config/agent-resolver.js');
        mockResolveAgentPath = vi.mocked(agentResolver.resolveAgentPath);

        mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit');
        });
    });

    it('outputs resolved path for valid agent', async () => {
        const resolvedPath = '/Users/test/.dexto/agents/test-agent/test-agent.yml';
        mockResolveAgentPath.mockResolvedValue(resolvedPath);

        await handleWhichCommand('test-agent');

        expect(mockResolveAgentPath).toHaveBeenCalledWith('test-agent', false);
        expect(mockConsoleLog).toHaveBeenCalledWith(resolvedPath);
    });

    it('handles agent not found error', async () => {
        const error = new Error('Agent not found');
        mockResolveAgentPath.mockRejectedValue(error);

        await expect(handleWhichCommand('nonexistent-agent')).rejects.toThrow('process.exit');

        expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringContaining("❌ Agent 'nonexistent-agent' not found")
        );
        expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
});
