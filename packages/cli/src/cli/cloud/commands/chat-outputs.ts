import { z } from 'zod';
import {
    argument,
    integerOption,
    PAGE_OPTIONS,
    stringOption,
    UsageError,
    type Command,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const OutputSchema = z
    .object({
        id: z.string(),
        kind: z.enum(['file', 'artifact']),
        name: z.string(),
        reference: z.string(),
        mimeType: z.string().nullable(),
        sizeBytes: z.number().nullable(),
        createdAt: z.string(),
        url: z.string().nullable(),
    })
    .passthrough();
const PageSchema = z.object({ outputs: z.array(OutputSchema), nextCursor: z.string().nullable() });

export const chatOutputsCommand: Command = {
    arguments: '<chat_id>',
    options: PAGE_OPTIONS,
    path: ['chat', 'outputs'],
    summary: 'List files and resources produced by a chat.',
    async run(context, input) {
        const sessionId = argument(input, 0, 'chat_id');
        const limit = integerOption(input, 'limit');
        if (limit !== undefined && (limit < 1 || limit > 100))
            throw new UsageError('--limit must be between 1 and 100.');
        const cursor = stringOption(input, 'after');
        await requireLoginScopes(context, ['sessions:read']);
        const page = PageSchema.parse(
            await queryWorkspaceTool(context, 'dexto_chat_outputs_list', {
                sessionId,
                ...(limit === undefined ? {} : { limit }),
                ...(cursor === undefined ? {} : { cursor }),
            })
        );
        context.output.list(
            { data: page.outputs, has_more: page.nextCursor !== null, next_after: page.nextCursor },
            [
                { header: 'name', value: (output) => output.name },
                { header: 'type', value: (output) => output.mimeType ?? output.kind },
                { header: 'size', value: (output) => output.sizeBytes },
                { header: 'created', value: (output) => output.createdAt },
                { header: 'url', value: (output) => output.url },
            ]
        );
    },
};
