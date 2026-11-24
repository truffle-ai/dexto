import { describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import type { CommandContext } from '../command.js';
import { docsCommands } from './docs.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [search, read] = docsCommands;
if (search === undefined || read === undefined) throw new Error('docs commands are missing');

const page = {
    description: 'Connect an MCP client.',
    path: 'mcp/setup',
    snippet: '…add the Dexto MCP server…',
    title: 'MCP setup',
    url: 'https://www.dexto.ai/docs/mcp/setup/',
};

function contextFor(json: boolean) {
    const list = vi.fn();
    const record = vi.fn();
    const writeOutput = vi.fn();
    const context = {
        output: { json, jsonContent: json, list, record },
        runtime: { writeOutput },
    } as unknown as CommandContext;
    return { context, list, record, writeOutput };
}

describe('docs search', () => {
    it('sends the joined query and limit, and lists the results as data', async () => {
        const { context, list } = contextFor(true);
        query.mockResolvedValueOnce({ results: [page] });
        await search.run(context, { positionals: ['mcp', 'setup'], values: { limit: '3' } });
        expect(query).toHaveBeenCalledWith(context, 'dexto_docs_search', {
            query: 'mcp setup',
            limit: 3,
        });
        expect(list).toHaveBeenCalledWith({ data: [page] }, expect.any(Array));
    });

    it('lists pages for people and leaves the limit to the tool when not given', async () => {
        const { context, list } = contextFor(false);
        query.mockResolvedValueOnce({ results: [page] });
        await search.run(context, { positionals: ['mcp'], values: {} });
        expect(query).toHaveBeenLastCalledWith(context, 'dexto_docs_search', { query: 'mcp' });
        expect(list).toHaveBeenCalledWith({ data: [page] }, expect.any(Array));
    });

    it('rejects an empty query and an out-of-range limit before calling', async () => {
        const { context } = contextFor(true);
        query.mockClear();
        await expect(search.run(context, { positionals: [' '], values: {} })).rejects.toThrow(
            'Say what to search for'
        );
        await expect(
            search.run(context, { positionals: ['mcp'], values: { limit: '21' } })
        ).rejects.toThrow('--limit must be between 1 and 20');
        expect(query).not.toHaveBeenCalled();
    });
});

describe('docs read', () => {
    const markdown = { ...page, markdown: 'Add the server.' };

    it('reads a path and prints the page record as JSON', async () => {
        const { context, record } = contextFor(true);
        query.mockResolvedValueOnce(markdown);
        await read.run(context, { positionals: ['mcp/setup'], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_docs_read', { path: 'mcp/setup' });
        expect(record).toHaveBeenCalledWith(markdown);
    });

    it('prints Markdown for people and reads the docs home without a path', async () => {
        const { context, writeOutput } = contextFor(false);
        query.mockResolvedValueOnce(markdown);
        await read.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenLastCalledWith(context, 'dexto_docs_read', { path: '' });
        expect(writeOutput).toHaveBeenCalledWith(
            '# MCP setup\nhttps://www.dexto.ai/docs/mcp/setup/\n\nAdd the server.\n'
        );
    });

    it("keeps the tool's not-found failure", async () => {
        const { context } = contextFor(true);
        const notFound = new CommandFailure('not_found', 'Dexto docs page was not found.', null);
        query.mockRejectedValueOnce(notFound);
        await expect(read.run(context, { positionals: ['nope'], values: {} })).rejects.toBe(
            notFound
        );
    });
});
