// `cloud search` and `cloud fetch`: the web as /v1/search and /v1/fetch serve it.

import { unwrap } from '@dexto/cloud-client';
import { integerOption, type Command } from '../command.js';

const search: Command = {
    arguments: '<query...>',
    options: {
        num: { description: 'How many results (default 10).', type: 'string', valueName: 'N' },
    },
    path: ['cloud', 'search'],
    summary: 'Search the web.',
    async run(context, input) {
        const numResults = integerOption(input, 'num');
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/search', {
                body: {
                    query: input.positionals.join(' '),
                    ...(numResults === undefined ? {} : { num_results: numResults }),
                },
            })
        );
        if (context.output.json) return context.output.record(result);
        for (const item of result.results)
            context.runtime.writeOutput(
                `${item.title ?? item.url}\n  ${item.url}${item.highlights.length === 0 ? '' : `\n  ${item.highlights[0]}`}\n\n`
            );
    },
};

const fetchPages: Command = {
    arguments: '<url...>',
    options: {
        'max-chars': {
            description: 'Text characters per page, 100 to 100000 (default 20000).',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['cloud', 'fetch'],
    summary: 'Read up to 10 web pages as text.',
    async run(context, input) {
        const maxCharacters = integerOption(input, 'max-chars');
        const result = await unwrap(
            await (
                await context.client()
            ).POST('/v1/fetch', {
                body: {
                    urls: [...input.positionals],
                    ...(maxCharacters === undefined ? {} : { max_characters: maxCharacters }),
                },
            })
        );
        if (context.output.jsonContent) return context.output.record(result);
        for (const page of result.results)
            context.runtime.writeOutput(
                page.status === 'ok'
                    ? `# ${page.title ?? page.url}\n${page.url}\n\n${page.text ?? ''}\n\n`
                    : `# ${page.url}\nFailed: ${page.error?.code ?? 'error'}\n\n`
            );
        return result.results.some((page) => page.status === 'error') ? 1 : 0;
    },
};

export const webCommands: readonly Command[] = [search, fetchPages];
