// `docs`: search and read Dexto's public documentation, as dexto_docs_search and dexto_docs_read do.

import { z } from 'zod';

import { integerOption, UsageError, type Command } from '../command.js';
import { queryWorkspaceTool } from './workspace.js';

const SearchSchema = z.object({
    results: z.array(
        z
            .object({
                description: z.string(),
                path: z.string(),
                snippet: z.string(),
                title: z.string(),
                url: z.string(),
            })
            .passthrough()
    ),
});

const PageSchema = z
    .object({
        description: z.string(),
        markdown: z.string(),
        path: z.string(),
        title: z.string(),
        url: z.string(),
    })
    .passthrough();

const search: Command = {
    arguments: '<query...>',
    examples: ['dexto docs search "mcp catalog" --limit 3 --json'],
    options: {
        limit: {
            description: 'How many pages to return, 1 to 20 (default 5).',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['docs', 'search'],
    summary:
        'Search Dexto\'s public documentation, such as dexto docs search "mcp catalog"; read a page with dexto docs read <path>.',
    async run(context, input) {
        const query = input.positionals.join(' ').trim();
        if (query.length === 0)
            throw new UsageError(
                'Say what to search for, such as: dexto docs search "mcp catalog".'
            );
        if (query.length > 200) throw new UsageError('The query must be at most 200 characters.');
        const limit = integerOption(input, 'limit');
        if (limit !== undefined && (limit < 1 || limit > 20))
            throw new UsageError('--limit must be between 1 and 20.');
        const found = SearchSchema.parse(
            await queryWorkspaceTool(context, 'dexto_docs_search', {
                query,
                ...(limit === undefined ? {} : { limit }),
            })
        );
        if (context.output.json) return context.output.record(found);
        context.output.list({ data: found.results }, [
            { header: 'path', value: (page) => page.path },
            { header: 'title', value: (page) => page.title },
            { header: 'url', value: (page) => page.url },
        ]);
    },
};

const read: Command = {
    arguments: '[path]',
    examples: ['dexto docs read cli/output', 'dexto docs read cli/output --json'],
    path: ['docs', 'read'],
    summary:
        'Read one public Dexto documentation page as Markdown, by a path from dexto docs search; no path reads the docs home.',
    async run(context, input) {
        const path = input.positionals[0] ?? '';
        if (path.length > 200) throw new UsageError('The path must be at most 200 characters.');
        const page = PageSchema.parse(
            await queryWorkspaceTool(context, 'dexto_docs_read', { path })
        );
        if (context.output.jsonContent) return context.output.record(page);
        context.runtime.writeOutput(`# ${page.title}\n${page.url}\n\n${page.markdown}\n`);
    },
};

export const docsCommands: readonly Command[] = [search, read];
