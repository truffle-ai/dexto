import { describe, expect, it } from 'vitest';
import { InMemoryDextoStores, InMemoryToolOutputStore } from '../storage/stores/in-memory.js';
import type { InternalMessage } from '../context/types.js';
import { createToolOutputReadTool } from './tool-output-read.js';
import type { ToolExecutionContext } from './types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

async function setup() {
    const stores = new InMemoryDextoStores();
    const toolOutputs = new InMemoryToolOutputStore();
    const tool = createToolOutputReadTool({
        conversation: stores.getStore('conversation'),
        toolOutputs,
    });
    const read = async (sessionId: string | undefined, input: Record<string, unknown>) =>
        tool.execute(tool.inputSchema.parse(input), {
            logger: createMockLogger(),
            sessionId,
        } satisfies ToolExecutionContext);
    return { stores, toolOutputs, read };
}

const numbered = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`).join('\n');

describe('tool_output_read', () => {
    it('reads a stored output in pages with a continuation hint', async () => {
        const { toolOutputs, read } = await setup();
        await toolOutputs.save({ sessionId: 's1', toolCallId: 'call-1', text: numbered });

        const first = await read('s1', { id: 'call-1' });
        const next = await read('s1', { id: 'call-1', offset: 2001, limit: 2 });

        expect(first).toContain('1: line 1\n2: line 2');
        expect(first).toContain('[Showing lines 1-2000 of 3000. Use offset=2001 to continue.]');
        expect(next).toBe(
            '2001: line 2001\n2002: line 2002\n\n[Showing lines 2001-2002 of 3000. Use offset=2003 to continue.]'
        );
    });

    it('searches a stored output and reports matching line numbers', async () => {
        const { toolOutputs, read } = await setup();
        await toolOutputs.save({ sessionId: 's1', toolCallId: 'call-1', text: numbered });

        const found = await read('s1', { id: 'call-1', pattern: 'line 29\\d\\d$', maxMatches: 2 });

        expect(found).toBe(
            '2900: line 2900\n2901: line 2901\n\n[Showing 2 of 100 matching lines; raise maxMatches or narrow the pattern. Read around a match with offset.]'
        );
    });

    it('reads a pruned result back from the session history', async () => {
        const { stores, read } = await setup();
        const message: InternalMessage = {
            role: 'tool',
            toolCallId: 'call-old',
            name: 'read_file',
            content: [{ type: 'text', text: 'original\ncontent' }],
            compactedAt: 1,
        };
        await stores.getStore('conversation').saveMessage({ sessionId: 's1', message });

        expect(await read('s1', { id: 'call-old' })).toBe(
            '1: original\n2: content\n\n[Showing lines 1-2 of 2.]'
        );
    });

    it('never resolves an id from another session', async () => {
        const { stores, toolOutputs, read } = await setup();
        await toolOutputs.save({ sessionId: 'owner-a', toolCallId: 'call-1', text: 'secret' });
        await stores.getStore('conversation').saveMessage({
            sessionId: 'owner-a',
            message: {
                role: 'tool',
                toolCallId: 'call-2',
                name: 'read_file',
                content: [{ type: 'text', text: 'secret' }],
            },
        });

        for (const id of ['call-1', 'call-2']) {
            const result = await read('owner-b', { id });
            expect(result).toContain(`No stored output with id "${id}" in this conversation`);
            expect(result).not.toContain('secret');
        }
    });

    it('explains an expired or unknown id instead of failing', async () => {
        const { read } = await setup();

        expect(await read('s1', { id: 'call-gone' })).toBe(
            'No stored output with id "call-gone" in this conversation. It may have expired. Re-run the tool if it only reads data, or narrow the request.'
        );
    });

    it('requires a session', async () => {
        const { read } = await setup();

        await expect(read(undefined, { id: 'call-1' })).rejects.toThrow('needs a session');
    });
});
