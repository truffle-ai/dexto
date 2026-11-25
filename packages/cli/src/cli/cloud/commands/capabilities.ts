// `capabilities search`: page through the account capability catalog (Dexto platform tools,
// connected MCP servers and managed connections) over Dexto's typed search tool. It finds
// capabilities and never calls one.

import { z } from 'zod';
import { boundedOption, integerOption, UsageError, type Command } from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const SCOPES = ['capabilities:read'] as const;

const HitSchema = z
    .object({
        aliases: z.array(z.string()),
        description: z.string(),
        invocable: z.object({ mode: z.string() }).passthrough(),
        name: z.string(),
    })
    .passthrough();
const PageSchema = z
    .object({
        hasMore: z.boolean(),
        items: z.array(HitSchema),
        nextOffset: z.number().int().nullable(),
        total: z.number().int(),
    })
    .passthrough();

type Hit = z.output<typeof HitSchema>;

const COLUMNS: readonly Column<Hit>[] = [
    { header: 'path', value: (hit) => hit.aliases[0] ?? null },
    { header: 'name', value: (hit) => hit.name },
    { header: 'invocable', value: (hit) => hit.invocable.mode },
    { header: 'description', value: (hit) => hit.description },
];

const search: Command = {
    arguments: '<query...>',
    options: {
        limit: {
            description: 'How many to return (1 to 100, default 20).',
            type: 'string',
            valueName: 'N',
        },
        offset: {
            description: 'How many to skip: the nextOffset of the page before (default 0).',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['capabilities', 'search'],
    summary:
        'Search the capabilities your account can use: Dexto platform tools, connected MCP servers and managed connections.',
    examples: [
        'dexto capabilities search "deploy a site" --json',
        'dexto capabilities search github --limit 50 --offset 50 --json',
    ],
    async run(context, input) {
        const query = input.positionals.join(' ').trim();
        if (query.length === 0)
            throw new UsageError(
                'Say what to search for, such as: dexto capabilities search github.'
            );
        const limit = boundedOption(input, 'limit', 1, 100);
        const offset = integerOption(input, 'offset');
        if (offset !== undefined && offset < 0) throw new UsageError('--offset must be 0 or more.');
        await requireLoginScopes(context, SCOPES);
        const page = PageSchema.parse(
            await queryWorkspaceTool(context, 'dexto_capabilities_search', {
                query,
                ...(limit === undefined ? {} : { limit }),
                ...(offset === undefined ? {} : { offset }),
            })
        );
        // JSON keeps the tool's own page; people get a table and where the next page starts.
        if (context.output.json) return context.output.record(page);
        context.output.list({ data: page.items }, COLUMNS);
        if (page.nextOffset !== null)
            context.output.note(
                `${page.items.length} of ${page.total}. More results: add --offset ${page.nextOffset}`
            );
    },
};

export const capabilityCommands: readonly Command[] = [search];
