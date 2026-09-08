import { describe, expect, it, vi } from 'vitest';
import { executeCommand } from './commands.js';
import type { TuiAgentBackend, TuiAgentCapabilities } from '../agent-backend.js';

function createAgent(capabilities?: TuiAgentCapabilities): TuiAgentBackend {
    const skills = {
        list: vi.fn().mockResolvedValue([]),
        load: vi.fn().mockResolvedValue(null),
        readFile: vi.fn(),
    };

    return {
        capabilities,
        listPrompts: vi.fn(),
        skills,
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

    it('lists skills through Skills when prompt commands are disabled', async () => {
        const agent = createAgent({ prompts: false });
        const skills = agent.skills;
        if (!skills) throw new Error('Expected test agent to have skills');
        vi.mocked(skills.list).mockResolvedValue([
            {
                name: 'review',
                description: 'Review code changes',
            },
        ]);

        const result = await executeCommand('skills', [], agent);

        expect(skills.list).toHaveBeenCalled();
        expect(agent.listPrompts).not.toHaveBeenCalled();
        expect(result).toContain('Available Skills');
        expect(result).toContain('review');
    });

    it('loads one skill through Skills', async () => {
        const agent = createAgent();
        const skills = agent.skills;
        if (!skills) throw new Error('Expected test agent to have skills');
        vi.mocked(skills.load).mockResolvedValue({
            name: 'review',
            instructions: 'Check tests and edge cases.',
            supportingFiles: [],
            filesLocation: 'hosted',
            baseDirectory: null,
        });

        const result = await executeCommand('skills', ['review'], agent);

        expect(skills.load).toHaveBeenCalledWith('review');
        expect(agent.listPrompts).not.toHaveBeenCalled();
        expect(result).toContain('review');
        expect(result).toContain('Check tests and edge cases.');
    });
});
