import { describe, expect, it, vi } from 'vitest';
import { executeCommand } from './commands.js';
import type { TuiAgentBackend, TuiAgentCapabilities } from '../agent-backend.js';

function createAgent(capabilities?: TuiAgentCapabilities): TuiAgentBackend {
    return {
        capabilities,
        logger: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            getLevel: vi.fn(),
            getLogFilePath: vi.fn(),
        },
    } as unknown as TuiAgentBackend;
}

describe('executeCommand', () => {
    it('returns unknown-command guidance when prompts are unsupported and the command is not real', async () => {
        const agent = createAgent({ prompts: false });

        const result = await executeCommand('typoed-command', [], agent);

        expect(result).toContain('Unknown command');
    });

    it('still blocks static prompt commands when the prompts capability is disabled', async () => {
        const agent = createAgent({ prompts: false });

        const result = await executeCommand('prompts', [], agent);

        expect(result).toBe('⚠️  Command /prompts is not available for this chat target.');
    });
});
