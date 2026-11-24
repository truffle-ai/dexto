import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext, CommandInput } from '../command.js';
import { chatReadCommands } from './chat-read.js';

const query = vi.hoisted(() => vi.fn());
const scopes = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));
vi.mock('./deploys.js', () => ({ requireLoginScopes: scopes }));

function command(verb: string) {
    const found = chatReadCommands.find((each) => each.path.join(' ') === `chat ${verb}`);
    if (found === undefined) throw new Error(`Missing chat ${verb}`);
    return found;
}

function harness() {
    const list = vi.fn();
    const result = vi.fn();
    const context = { output: { json: true, list, result } } as unknown as CommandContext;
    return { context, list, result };
}

function input(positionals: string[], values: CommandInput['values'] = {}): CommandInput {
    return { positionals, values };
}

const lastRun = { id: 'run-1', status: 'failed' };
const chat = {
    id: 'chat-1',
    title: 'Fix the bug',
    status: 'idle',
    updatedAt: '2026-11-18T10:00:00.000Z',
    lastRun,
    url: 'https://app.dexto.ai/chat/chat-1',
};

beforeEach(() => {
    query.mockReset();
    scopes.mockReset();
});

describe('chat list', () => {
    it('maps every flag to dexto_chat_list and returns its chats with the next cursor', async () => {
        const { context, list } = harness();
        query.mockResolvedValueOnce({
            untrustedContent: true,
            pagination: { hasMore: true, limit: 2, nextCursor: 'next-1' },
            sessions: [chat],
        });
        await command('list').run(
            context,
            input([], {
                status: 'idle',
                'imported-from': 'codex',
                limit: '2',
                after: 'cursor-1',
            })
        );
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:read']);
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_list', {
            status: 'idle',
            importedFrom: 'codex',
            limit: 2,
            cursor: 'cursor-1',
        });
        expect(list).toHaveBeenCalledWith(
            { data: [chat], has_more: true, next_after: 'next-1' },
            expect.any(Array)
        );
    });

    it('searches with --query, which returns no cursor', async () => {
        const { context, list } = harness();
        query.mockResolvedValueOnce({
            untrustedContent: true,
            query: 'bug',
            sessions: [{ ...chat, snippet: 'the bug' }],
        });
        await command('list').run(context, input([], { query: 'bug' }));
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_list', { query: 'bug' });
        expect(list).toHaveBeenCalledWith(
            { data: [{ ...chat, snippet: 'the bug' }], has_more: false, next_after: null },
            expect.any(Array)
        );
    });

    it('shows id, title, status, last run and updated time', async () => {
        const { context, list } = harness();
        query.mockResolvedValueOnce({
            pagination: { hasMore: false, limit: 20, nextCursor: null },
            sessions: [chat, { ...chat, id: 'chat-2', title: null, lastRun: null }],
        });
        await command('list').run(context, input([]));
        const columns: { header: string; value: (row: typeof chat) => unknown }[] =
            list.mock.calls[0]?.[1];
        expect(columns.map((column) => column.header)).toEqual([
            'id',
            'title',
            'status',
            'last run',
            'updated',
        ]);
        expect(columns.map((column) => column.value(chat))).toEqual([
            'chat-1',
            'Fix the bug',
            'idle',
            'failed',
            '2026-11-18T10:00:00.000Z',
        ]);
        expect(
            columns.map((column) => column.value({ ...chat, title: null, lastRun: null } as never))
        ).toEqual(['chat-1', '', 'idle', '', '2026-11-18T10:00:00.000Z']);
    });

    it.each([
        [{ status: 'done' }, '--status must be one of'],
        [{ 'imported-from': 'cursor' }, '--imported-from must be one of'],
        [{ limit: '51' }, '--limit must be between 1 and 50'],
        [{ limit: '0' }, '--limit must be between 1 and 50'],
        [{ query: 'bug', after: 'cursor-1' }, '--after does not page a --query search'],
    ])('rejects %o before calling Dexto', async (values, message) => {
        await expect(command('list').run(harness().context, input([], values))).rejects.toThrow(
            message
        );
        expect(query).not.toHaveBeenCalled();
    });
});

describe('chat list hint for local chats', () => {
    const page = { pagination: { hasMore: false, limit: 20, nextCursor: null }, sessions: [chat] };

    function tableContext(openLocalAgent: () => Promise<unknown>) {
        const list = vi.fn();
        const note = vi.fn();
        const context = {
            output: { json: false, list, note },
            openLocalAgent,
        } as unknown as CommandContext;
        return { context, note };
    }

    it('points to --local after the cloud list when this machine has chats', async () => {
        query.mockResolvedValueOnce(page);
        const { context, note } = tableContext(async () => ({
            listSessions: async () => ['a', 'b'],
        }));
        await command('list').run(context, input([]));
        expect(note).toHaveBeenCalledWith(
            'This machine also has 2 local chats: dexto chat list --local'
        );
    });

    it('says nothing when this machine has no chats or its agent cannot open', async () => {
        query.mockResolvedValueOnce(page);
        const empty = tableContext(async () => ({ listSessions: async () => [] }));
        await command('list').run(empty.context, input([]));
        expect(empty.note).not.toHaveBeenCalled();

        query.mockResolvedValueOnce(page);
        const broken = tableContext(async () => {
            throw new Error('no agent config');
        });
        await expect(command('list').run(broken.context, input([]))).resolves.toBeUndefined();
        expect(broken.note).not.toHaveBeenCalled();
    });

    it('never opens the local agent for --json', async () => {
        query.mockResolvedValueOnce(page);
        const openLocalAgent = vi.fn();
        const { list } = harness();
        const context = {
            output: { json: true, list },
            openLocalAgent,
        } as unknown as CommandContext;
        await command('list').run(context, input([]));
        expect(openLocalAgent).not.toHaveBeenCalled();
    });
});

describe('chat list --local', () => {
    it("lists this machine's chats, most recently active first, without calling Dexto", async () => {
        const { context, list } = harness();
        const metadata: Record<
            string,
            { lastActivity: number; messageCount: number; title?: string }
        > = {
            old: {
                lastActivity: Date.parse('2026-11-01T00:00:00Z'),
                messageCount: 2,
                title: 'Old',
            },
            new: { lastActivity: Date.parse('2026-11-18T00:00:00Z'), messageCount: 5 },
        };
        const agent = {
            listSessions: async () => ['old', 'new'],
            getSessionMetadata: async (id: string) => metadata[id],
        };
        const local = {
            ...context,
            openLocalAgent: async () => agent,
        } as unknown as CommandContext;
        await command('list').run(local, input([], { local: true }));
        expect(query).not.toHaveBeenCalled();
        expect(scopes).not.toHaveBeenCalled();
        expect(list).toHaveBeenCalledWith(
            {
                data: [
                    {
                        id: 'new',
                        title: null,
                        messages: 5,
                        lastActivity: '2026-11-18T00:00:00.000Z',
                    },
                    {
                        id: 'old',
                        title: 'Old',
                        messages: 2,
                        lastActivity: '2026-11-01T00:00:00.000Z',
                    },
                ],
            },
            expect.any(Array)
        );
    });

    it('takes none of the cloud filters', async () => {
        await expect(
            command('list').run(harness().context, input([], { local: true, status: 'idle' }))
        ).rejects.toThrow('--local lists every chat on this machine; drop --status');
    });
});

describe('chat get', () => {
    const page = {
        messages: [
            {
                id: 'm1',
                role: 'user',
                text: 'Fix it',
                createdAt: '2026-11-18T09:00:00.000Z',
                runId: 'run-1',
                sequence: 3,
            },
            {
                id: 'm2',
                role: 'assistant',
                text: 'Fixed.',
                createdAt: '2026-11-18T09:01:00.000Z',
                runId: 'run-1',
                sequence: 4,
            },
        ],
        pagination: { hasMore: true, limit: 2, nextCursor: '3' },
        session: chat,
        usage: { access: 'withheld' },
        runBilling: null,
    };

    it('maps the id and paging to dexto_chat_get and returns its page unchanged', async () => {
        const { context, result } = harness();
        query.mockResolvedValueOnce(page);
        await command('get').run(context, input(['chat-1'], { limit: '2', after: '7' }));
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:read']);
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_get', {
            sessionId: 'chat-1',
            limit: 2,
            cursor: '7',
        });
        expect(result).toHaveBeenCalledWith(page, expect.any(String));
    });

    it('prints the chat, its last run, each message and how to read older ones', async () => {
        const { context, result } = harness();
        query.mockResolvedValueOnce(page);
        await command('get').run(context, input(['chat-1']));
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_get', { sessionId: 'chat-1' });
        expect(result.mock.calls[0]?.[1]).toBe(
            [
                'Fix the bug',
                'https://app.dexto.ai/chat/chat-1',
                'Status: idle; last run failed',
                '',
                'user, 2026-11-18T09:00:00.000Z',
                'Fix it',
                '',
                'assistant, 2026-11-18T09:01:00.000Z',
                'Fixed.',
                '',
                'Older messages: dexto chat get chat-1 --after 3',
            ].join('\n')
        );
    });

    it('requires a chat id and a limit Dexto accepts', async () => {
        await expect(command('get').run(harness().context, input([]))).rejects.toThrow(
            'Missing chat_id'
        );
        await expect(
            command('get').run(harness().context, input(['chat-1'], { limit: '51' }))
        ).rejects.toThrow('--limit must be between 1 and 50');
        expect(query).not.toHaveBeenCalled();
    });
});

describe('chat models', () => {
    it('lists the models from dexto_chat_models with their routes', async () => {
        const { context, list } = harness();
        const grok = {
            id: 'grok-4.7',
            name: 'Grok 4.7',
            current: true,
            routes: ['dexto_credits'],
            maxInputTokens: 256000,
            pricePerMillion: null,
            reasoning: true,
        };
        const opus = {
            id: 'claude-opus-5-5',
            name: 'Claude Opus 5.5',
            current: false,
            routes: ['dexto_credits', 'claude_code'],
            maxInputTokens: null,
            pricePerMillion: null,
            reasoning: null,
        };
        const models = [grok, opus];
        query.mockResolvedValueOnce({ models });
        await command('models').run(context, input([]));
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:read']);
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_models', {});
        expect(list).toHaveBeenCalledWith({ data: models }, expect.any(Array));
        const columns: { header: string; value: (row: typeof grok | typeof opus) => unknown }[] =
            list.mock.calls[0]?.[1];
        expect(columns.map((column) => column.value(opus))).toEqual([
            'claude-opus-5-5',
            'Claude Opus 5.5',
            'dexto_credits, claude_code',
            '',
        ]);
        expect(columns.at(-1)?.value(grok)).toBe('yes');
    });
});

describe('chat history', () => {
    const message = (sequence: number, text: string) => ({
        id: `m${sequence}`,
        role: sequence % 2 === 0 ? 'assistant' : 'user',
        text,
        createdAt: `2026-11-18T09:0${sequence}:00.000Z`,
        sequence,
    });

    it('reads every page of a cloud chat, oldest first, without the local agent', async () => {
        const openLocalAgent = vi.fn();
        const result = vi.fn();
        const context = {
            output: { json: true, result },
            openLocalAgent,
        } as unknown as CommandContext;
        query
            .mockResolvedValueOnce({
                session: chat,
                messages: [message(3, 'Third'), message(4, 'Fourth')],
                pagination: { nextCursor: '3' },
            })
            .mockResolvedValueOnce({
                session: chat,
                messages: [message(1, 'First'), message(2, 'Second')],
                pagination: { nextCursor: null },
            });
        await command('history').run(context, input(['chat-1']));
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:read']);
        expect(query.mock.calls.map((call) => call[2])).toEqual([
            { sessionId: 'chat-1', limit: 50 },
            { sessionId: 'chat-1', limit: 50, cursor: '3' },
        ]);
        expect(openLocalAgent).not.toHaveBeenCalled();
        expect(result).toHaveBeenCalledWith(
            {
                session: chat,
                messages: ['First', 'Second', 'Third', 'Fourth'].map((text, index) =>
                    message(index + 1, text)
                ),
            },
            expect.stringContaining('user, 2026-11-18T09:01:00.000Z\nFirst')
        );
    });

    it('points a chat Dexto does not have to --local', async () => {
        const { CommandFailure } = await import('../../failure.js');
        query.mockRejectedValueOnce(
            new CommandFailure('not_found', 'Dexto session was not found.', null)
        );
        await expect(
            command('history').run(harness().context, input(['local-1']))
        ).rejects.toMatchObject({
            kind: 'not_found',
            fix: 'dexto chat history local-1 --local',
        });
    });

    it('reads a chat on this machine with --local, without calling Dexto', async () => {
        const result = vi.fn();
        const history = [{ role: 'user', content: 'Hi', timestamp: 1 }];
        const agent = {
            getSessionMetadata: async (id: string) =>
                id === 'local-1' ? { lastActivity: 1, messageCount: 1 } : undefined,
            getSessionHistory: vi.fn(async () => history),
        };
        const context = {
            output: { json: true, result },
            openLocalAgent: async () => agent,
        } as unknown as CommandContext;
        await command('history').run(context, input(['local-1'], { local: true }));
        expect(query).not.toHaveBeenCalled();
        expect(scopes).not.toHaveBeenCalled();
        expect(result).toHaveBeenCalledWith(
            { sessionId: 'local-1', messages: history },
            expect.any(String)
        );

        await expect(
            command('history').run(context, input(['cloud-1'], { local: true }))
        ).rejects.toMatchObject({ kind: 'not_found', fix: 'dexto chat history cloud-1' });
    });

    it('requires a chat id', async () => {
        await expect(command('history').run(harness().context, input([]))).rejects.toThrow(
            'Missing chat_id'
        );
    });
});

describe('chat read commands', () => {
    it('have copy-paste examples with shell-variable ids', () => {
        for (const each of chatReadCommands) {
            expect(each.examples?.length).toBeGreaterThan(0);
            for (const example of each.examples ?? []) {
                expect(example).toMatch(/^dexto chat /);
                expect(example).not.toMatch(/</);
            }
        }
    });
});
