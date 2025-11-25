import { describe, test, expect } from 'vitest';
import { PromptManager } from './prompt-manager.js';
import type { PromptDefinition } from './types.js';

const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    trackException: () => {},
    createChild: () => mockLogger,
    destroy: async () => {},
} as any;

function makeFakeMCPManager(capture: { lastArgs?: any }) {
    const def: PromptDefinition = {
        name: 'analyze-metrics',
        description: 'Analyze metrics',
        arguments: [
            { name: 'metric_type', required: true },
            { name: 'time_period', required: false },
        ],
    };
    return {
        getAllPromptMetadata() {
            return [{ promptName: 'analyze-metrics', serverName: 'demo', definition: def }];
        },
        getPromptMetadata(_name: string) {
            return def;
        },
        async getPrompt(name: string, args?: Record<string, unknown>) {
            capture.lastArgs = args;
            return {
                messages: [{ role: 'user', content: { type: 'text', text: `Prompt: ${name}` } }],
            } as any;
        },
    } as any;
}

describe('PromptManager MCP args mapping/filtering', () => {
    test('maps positional to named and filters internal keys for MCP', async () => {
        const capture: any = {};
        const fakeMCP = makeFakeMCPManager(capture);
        const resourceManagerStub = { getBlobStore: () => undefined } as any;
        const agentConfig: any = { prompts: [] };
        const eventBus: any = { on: () => {}, emit: () => {} };
        const dbStub: any = {
            connect: async () => {},
            list: async () => [],
            get: async () => undefined,
        };

        const pm = new PromptManager(
            fakeMCP,
            resourceManagerStub,
            agentConfig,
            eventBus,
            dbStub,
            mockLogger
        );
        await pm.initialize();
        await pm.getPrompt('analyze-metrics', {
            _positional: ['users', 'Q4 2024'],
            _context: 'ignore-me',
            extraneous: 'should-drop',
        } as any);

        expect(capture.lastArgs).toEqual({ metric_type: 'users', time_period: 'Q4 2024' });
    });
});
