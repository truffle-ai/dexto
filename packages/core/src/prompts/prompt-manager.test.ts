import { describe, test, expect } from 'vitest';
import { PromptManager } from './prompt-manager.js';
import type { PromptDefinition } from './types.js';
import { createSilentMockLogger } from '../logger/v2/test-utils.js';

const mockLogger = createSilentMockLogger();

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

describe('PromptManager getPromptDefinition', () => {
    test('returns context field from config prompts', async () => {
        const fakeMCP = {
            getAllPromptMetadata() {
                return [];
            },
            getPromptMetadata() {
                return undefined;
            },
            async getPrompt() {
                return { messages: [] };
            },
        } as any;
        const resourceManagerStub = { getBlobStore: () => undefined } as any;
        const agentConfig: any = {
            prompts: [
                {
                    type: 'inline',
                    id: 'fork-skill',
                    prompt: 'A skill with fork context',
                    description: 'Test fork skill',
                    context: 'fork',
                },
            ],
        };
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
        const def = await pm.getPromptDefinition('config:fork-skill');

        expect(def).toMatchObject({
            name: 'config:fork-skill',
            description: 'Test fork skill',
            context: 'fork',
        });
    });

    test('returns undefined context when not specified', async () => {
        const fakeMCP = {
            getAllPromptMetadata() {
                return [];
            },
            getPromptMetadata() {
                return undefined;
            },
            async getPrompt() {
                return { messages: [] };
            },
        } as any;
        const resourceManagerStub = { getBlobStore: () => undefined } as any;
        const agentConfig: any = {
            prompts: [
                {
                    type: 'inline',
                    id: 'inline-skill',
                    prompt: 'A skill without context',
                    description: 'Test inline skill',
                },
            ],
        };
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
        const def = await pm.getPromptDefinition('config:inline-skill');

        expect(def).toMatchObject({
            name: 'config:inline-skill',
            description: 'Test inline skill',
        });
        expect(def?.context).toBeUndefined();
    });
});

describe('PromptManager resolvePrompt', () => {
    test('resolves config prompts by fully-qualified key', async () => {
        const fakeMCP = {
            getAllPromptMetadata() {
                return [];
            },
            getPromptMetadata() {
                return undefined;
            },
            async getPrompt() {
                return { messages: [] };
            },
        } as any;
        const resourceManagerStub = { getBlobStore: () => undefined } as any;
        const agentConfig: any = {
            prompts: [
                {
                    type: 'inline',
                    id: 'dexto-plan-mode',
                    description: 'Internal plan-mode prompt',
                    prompt: 'You are in PLAN MODE.\nUse `custom--plan_create`.',
                    'user-invocable': false,
                    'disable-model-invocation': true,
                },
            ],
        };
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

        const result = await pm.resolvePrompt('config:dexto-plan-mode');
        expect(result.text).toContain('PLAN MODE');
        expect(result.text).toContain('custom--plan_create');
    });
});
