import { describe, expect, it } from 'vitest';
import type { InternalMessage } from '../../context/types.js';
import { findRepeatedPrunedToolCalls } from './repeated-pruned-tool-calls.js';

function readCall(id: string, path: string): InternalMessage {
    return {
        role: 'assistant',
        content: null,
        assistantOutput: { status: 'complete' },
        toolCalls: [
            {
                id,
                type: 'function',
                function: { name: 'read_file', arguments: JSON.stringify({ path }) },
            },
        ],
    };
}

function readResult(toolCallId: string, compactedAt?: number): InternalMessage {
    return {
        role: 'tool',
        toolCallId,
        name: 'read_file',
        content: [{ type: 'text', text: 'contents' }],
        ...(compactedAt !== undefined ? { compactedAt } : {}),
    };
}

const summary: InternalMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: 'summary' }],
    assistantOutput: { status: 'complete' },
    metadata: { isSummary: true },
};

describe('findRepeatedPrunedToolCalls', () => {
    it('counts every earlier identical call whose result was pruned', () => {
        const history = [
            readCall('call-1', 'a.txt'),
            readResult('call-1', 1),
            readCall('call-2', 'a.txt'),
            readResult('call-2', 2),
            readCall('call-3', 'a.txt'),
        ];

        expect(findRepeatedPrunedToolCalls(history)).toEqual([
            {
                toolName: 'read_file',
                toolCallId: 'call-3',
                prunedToolCallId: 'call-2',
                repeatCount: 2,
            },
        ]);
    });

    it('ignores repeats of calls whose results are still visible or have other arguments', () => {
        const history = [
            readCall('call-1', 'a.txt'),
            readResult('call-1'),
            readCall('call-2', 'b.txt'),
            readResult('call-2', 1),
            readCall('call-3', 'a.txt'),
        ];

        expect(findRepeatedPrunedToolCalls(history)).toEqual([]);
    });

    it('ignores pruned calls from before the latest summary', () => {
        const history = [
            readCall('call-1', 'a.txt'),
            readResult('call-1', 1),
            summary,
            readCall('call-2', 'a.txt'),
        ];

        expect(findRepeatedPrunedToolCalls(history)).toEqual([]);
    });
});
