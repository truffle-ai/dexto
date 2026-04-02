import { describe, expect, it } from 'vitest';
import {
    isCommandSupported,
    type TuiAgentBackend,
    type TuiAgentCapabilities,
} from './agent-backend.js';

function createAgent(capabilities?: TuiAgentCapabilities): TuiAgentBackend {
    return { capabilities } as unknown as TuiAgentBackend;
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
});
