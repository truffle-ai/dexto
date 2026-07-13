import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import { defineTool } from '../define-tool.js';
import type { ToolActivityPresentation } from '../types.js';
import { ToolPresentation } from './tool-presentation.js';

const writeActivity = {
    category: 'file-write',
    label: { running: 'Writing file', completed: 'Wrote file' },
    summary: { verb: 'Wrote', singular: 'a file', plural: 'files' },
} satisfies ToolActivityPresentation;

const createActivity = {
    category: 'file-create',
    label: { running: 'Creating file', completed: 'Created file' },
    summary: { verb: 'Created', singular: 'a file', plural: 'files' },
} satisfies ToolActivityPresentation;

describe('ToolPresentation', () => {
    it('builds useful generic snapshots for local and MCP tools', () => {
        const presentation = new ToolPresentation(
            () => undefined,
            (_toolName, args) => args,
            (context) => ({ ...context, logger: createMockLogger() }),
            createMockLogger()
        );

        expect(presentation.buildGenericSnapshot('write_file')).toEqual({
            version: 1,
            source: { type: 'local' },
            header: { title: 'Write File' },
        });
        expect(presentation.buildGenericSnapshot('mcp--filesystem--read_file')).toEqual({
            version: 1,
            source: { type: 'mcp', mcpServerName: 'filesystem' },
            header: { title: 'Read File' },
        });
    });

    it('keeps tool-call event snapshots synchronous and ignores async descriptors', () => {
        const tool = defineTool({
            id: 'write_file',
            description: 'Write file',
            inputSchema: z.object({ path: z.string() }).strict(),
            execute: vi.fn(),
            presentation: {
                describeHeader: () => Promise.resolve({ title: 'Async Write' }),
                describeArgs: () => ({
                    summary: [{ label: 'path', display: 'ignored' }],
                }),
            },
        });
        const presentation = new ToolPresentation(
            () => tool,
            (_toolName, args) => args,
            (context) => ({ ...context, logger: createMockLogger() }),
            createMockLogger()
        );

        expect(
            presentation.snapshotForToolCallEvent({
                toolName: 'write_file',
                args: { path: 'src/app.ts' },
                toolCallId: 'call-1',
            })
        ).toEqual({
            version: 1,
            source: { type: 'local' },
            header: { title: 'Write File' },
            args: { summary: [{ label: 'path', display: 'ignored' }] },
        });
    });

    it('awaits descriptors for prepared calls and result augmentation', async () => {
        const tool = defineTool({
            id: 'write_file',
            description: 'Write file',
            inputSchema: z.object({ path: z.string() }).strict(),
            execute: vi.fn(),
            presentation: {
                activity: writeActivity,
                describeHeader: async (args) => ({ title: 'Write', argsText: args.path }),
                describeResult: async () => ({ summaryText: 'written' }),
                describeResultActivity: async (display) =>
                    display?.type === 'file' && display.operation === 'create'
                        ? createActivity
                        : null,
            },
        });
        const presentation = new ToolPresentation(
            () => tool,
            (_toolName, args) => args,
            (context) => ({ ...context, logger: createMockLogger() }),
            createMockLogger()
        );

        const snapshot = await presentation.snapshotForCall({
            toolName: 'write_file',
            args: { path: 'src/app.ts' },
            toolCallId: 'call-1',
        });

        expect(snapshot.header).toEqual({ title: 'Write', argsText: 'src/app.ts' });
        expect(snapshot.activity).toEqual(writeActivity);
        await expect(
            presentation.augmentWithResult({
                toolName: 'write_file',
                snapshot,
                result: {
                    ok: true,
                    _display: {
                        type: 'file',
                        path: 'src/app.ts',
                        operation: 'create',
                    },
                },
                args: { path: 'src/app.ts' },
                toolCallId: 'call-1',
            })
        ).resolves.toEqual({
            ...snapshot,
            activity: createActivity,
            result: { summaryText: 'written' },
        });
    });
});
