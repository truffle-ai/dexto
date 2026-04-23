import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@dexto/core';
import { createAskUserTool } from './ask-user-tool.js';

describe('createAskUserTool', () => {
    it('accepts boolean property schemas and leaves them untouched during title enrichment', async () => {
        const tool = createAskUserTool();
        const getElicitationData = vi.fn().mockResolvedValue({ ok: true });
        const context = {
            services: {
                approval: {
                    getElicitationData,
                },
            },
        } as unknown as ToolExecutionContext;

        const input = tool.inputSchema.parse({
            question: 'Collect profile settings',
            schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                    },
                    ignored: true,
                },
                required: ['name'],
            },
        });

        await tool.execute(input, context);

        expect(getElicitationData).toHaveBeenCalledWith({
            prompt: 'Collect profile settings',
            schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        title: 'Name',
                    },
                    ignored: true,
                },
                required: ['name'],
            },
            serverName: 'Dexto Agent',
        });
    });
});
