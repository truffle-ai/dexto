import { describe, expect, it } from 'vitest';
import type { ToolSet as VercelToolSet } from 'ai';
import { createModelToolDefinitions } from './tool-definitions.js';
import type { ToolSet } from '../../tools/types.js';

const tools: ToolSet = {
    read_file: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
            },
            required: ['path'],
        },
    },
};

describe('tool definitions', () => {
    it('creates model tool definitions without execution hooks', async () => {
        const definitions = createModelToolDefinitions(tools);

        const tool = definitions.read_file as NonNullable<VercelToolSet['read_file']>;
        expect(tool.description).toBe('Read a file');
        expect('execute' in tool).toBe(false);
        expect('onInputAvailable' in tool).toBe(false);
        expect('outputSchema' in tool).toBe(true);
    });
});
