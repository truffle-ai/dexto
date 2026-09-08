import { describe, expect, it } from 'vitest';
import {
    isCommandSupported,
    type TuiAgentBackend,
    type TuiAgentCapabilities,
} from './agent-backend.js';

function createAgent(
    capabilities?: TuiAgentCapabilities,
    options: { hasSkills?: boolean } = {}
): TuiAgentBackend {
    return {
        capabilities,
        ...(options.hasSkills
            ? {
                  skills: {
                      list: async () => [],
                      load: async () => null,
                      readFile: async () => null,
                  },
              }
            : {}),
    } as unknown as TuiAgentBackend;
}

describe('isCommandSupported', () => {
    it('blocks capability-gated commands when the capability is disabled', () => {
        const agent = createAgent({ contextStats: false });

        expect(
            isCommandSupported(agent, 'tokens', {
                name: 'context',
                aliases: ['ctx', 'tokens'],
            })
        ).toBe(false);
    });

    it('requires both capability support and allowlist support when both are configured', () => {
        const agent = createAgent({
            supportedCommands: ['context'],
            contextStats: false,
        });

        expect(isCommandSupported(agent, 'context', { name: 'context', aliases: [] })).toBe(false);
    });

    it('still allows unrelated commands when only a different capability is disabled', () => {
        const agent = createAgent({ prompts: false });

        expect(isCommandSupported(agent, 'help', { name: 'help', aliases: ['h'] })).toBe(true);
    });

    it('gates skill commands separately from prompt commands', () => {
        const promptlessAgent = createAgent({ prompts: false }, { hasSkills: true });
        const skilllessAgent = createAgent({ skills: false }, { hasSkills: true });

        expect(isCommandSupported(promptlessAgent, 'skills', { name: 'skills', aliases: [] })).toBe(
            true
        );
        expect(isCommandSupported(skilllessAgent, 'skills', { name: 'skills', aliases: [] })).toBe(
            false
        );
    });

    it('requires a real Skills implementation for skill commands', () => {
        const agent = createAgent();

        expect(isCommandSupported(agent, 'skills', { name: 'skills', aliases: [] })).toBe(false);
    });
});
