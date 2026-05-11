import { describe, expect, it, vi } from 'vitest';
import type { ToolSet as VercelToolSet } from 'ai';
import {
    createExecutableVercelToolDefinitions,
    createIntentVercelToolDefinitions,
} from './tool-definitions.js';
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

describe('createVercelToolDefinitions', () => {
    it('creates executable AI SDK tools for the current in-memory driver', async () => {
        const execute = vi.fn(async () => ({ ok: true }));
        const toModelOutput = vi.fn(() => ({ type: 'text' as const, value: 'ok' }));

        const definitions = createExecutableVercelToolDefinitions(tools, {
            execute,
            toModelOutput,
        });

        const tool = definitions.read_file as NonNullable<VercelToolSet['read_file']>;
        expect(tool.description).toBe('Read a file');
        expect('outputSchema' in tool).toBe(false);
        expect(typeof tool.execute).toBe('function');

        await expect(
            tool.execute?.({ path: 'a.ts' }, { toolCallId: 'call-1', messages: [] })
        ).resolves.toEqual({ ok: true });
        expect(execute).toHaveBeenCalledWith({
            toolName: 'read_file',
            args: { path: 'a.ts' },
            options: { toolCallId: 'call-1', messages: [] },
        });
        expect(tool.toModelOutput?.({ ok: true })).toEqual({ type: 'text', value: 'ok' });
        expect(toModelOutput).toHaveBeenCalledWith({
            toolName: 'read_file',
            result: { ok: true },
        });
    });

    it('creates intent-only AI SDK tools for durable model-step callers', async () => {
        const onInputAvailable = vi.fn();

        const definitions = createIntentVercelToolDefinitions(tools, {
            onInputAvailable,
        });

        const tool = definitions.read_file as NonNullable<VercelToolSet['read_file']>;
        expect(tool.description).toBe('Read a file');
        expect('execute' in tool).toBe(false);
        expect('outputSchema' in tool).toBe(true);
        expect(typeof tool.onInputAvailable).toBe('function');

        await tool.onInputAvailable?.({
            input: { path: 'a.ts' },
            toolCallId: 'call-1',
            messages: [],
        });

        expect(onInputAvailable).toHaveBeenCalledWith({
            toolName: 'read_file',
            args: { path: 'a.ts' },
            options: { toolCallId: 'call-1', messages: [] },
        });
    });
});
