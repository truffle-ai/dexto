import { describe, expect, it, vi } from 'vitest';
import { executeCommand } from './commands.js';
import type { TuiAgentBackend, TuiAgentCapabilities } from '../agent-backend.js';

function createAgent(capabilities?: TuiAgentCapabilities): TuiAgentBackend {
    const skillManager = {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        readFile: vi.fn(),
        invoke: vi.fn(),
        refresh: vi.fn(),
    };

    return {
        capabilities,
        listPrompts: vi.fn(),
        skillManager,
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

    it('lists skills through SkillManager when prompt commands are disabled', async () => {
        const agent = createAgent({ prompts: false });
        const skillManager = agent.skillManager;
        if (!skillManager) throw new Error('Expected test agent to have skills');
        vi.mocked(skillManager.list).mockResolvedValue([
            {
                id: 'review',
                displayName: 'Code Review',
                description: 'Review code changes',
            },
        ]);

        const result = await executeCommand('skills', [], agent);

        expect(skillManager.list).toHaveBeenCalled();
        expect(agent.listPrompts).not.toHaveBeenCalled();
        expect(result).toContain('Available Skills');
        expect(result).toContain('Code Review');
    });

    it('reads one skill through SkillManager', async () => {
        const agent = createAgent();
        const skillManager = agent.skillManager;
        if (!skillManager) throw new Error('Expected test agent to have skills');
        vi.mocked(skillManager.get).mockResolvedValue({
            id: 'review',
            displayName: 'Code Review',
            description: 'Review code changes',
            instructions: 'Check tests and edge cases.',
        });

        const result = await executeCommand('skills', ['review'], agent);

        expect(skillManager.get).toHaveBeenCalledWith('review');
        expect(agent.listPrompts).not.toHaveBeenCalled();
        expect(result).toContain('Code Review');
        expect(result).toContain('Check tests and edge cases.');
    });
});
