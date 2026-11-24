import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext, CommandInput } from '../command.js';
import { chatReadCommands } from './chat-read.js';

const CHAT_ID = '6f1c2a4e-8b3d-4c5a-9e7f-1a2b3c4d5e6f';

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
    id: CHAT_ID,
    title: 'Fix the bug',
    status: 'idle',
    updatedAt: '2026-11-18T10:00:00.000Z',
    lastRun,
    url: `https://app.dexto.ai/chat/${CHAT_ID}`,
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
            CHAT_ID,
            'Fix the bug',
            'idle',
            'failed',
            '2026-11-18T10:00:00.000Z',
        ]);
        expect(
            columns.map((column) => column.value({ ...chat, title: null, lastRun: null } as never))
        ).toEqual([CHAT_ID, '', 'idle', '', '2026-11-18T10:00:00.000Z']);
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

describe('chat get', () => {
    it('refuses a malformed chat id as invalid input, before calling Dexto', async () => {
        await expect(command('get').run(harness().context, input(['nope']))).rejects.toMatchObject({
            kind: 'invalid_input',
        });
        expect(query).not.toHaveBeenCalled();
    });

    it("passes a chat's link to Dexto as given, which reads it", async () => {
        const link = `https://app.dexto.ai/desktop/apps/chat?session=${CHAT_ID}`;
        query.mockRejectedValueOnce(new Error('stop'));
        await expect(command('get').run(harness().context, input([link]))).rejects.toThrow('stop');
        expect(query).toHaveBeenCalledWith(expect.anything(), 'dexto_chat_get', {
            sessionId: link,
        });
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
        await command('get').run(context, input([CHAT_ID], { limit: '2', after: '7' }));
        expect(scopes).toHaveBeenCalledWith(context, ['sessions:read']);
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_get', {
            sessionId: CHAT_ID,
            limit: 2,
            cursor: '7',
        });
        expect(result).toHaveBeenCalledWith(page, expect.any(String));
    });

    it('prints the chat, its last run, each message and how to read older ones', async () => {
        const { context, result } = harness();
        query.mockResolvedValueOnce(page);
        await command('get').run(context, input([CHAT_ID]));
        expect(query).toHaveBeenCalledWith(context, 'dexto_chat_get', { sessionId: CHAT_ID });
        expect(result.mock.calls[0]?.[1]).toBe(
            [
                'Fix the bug',
                `https://app.dexto.ai/chat/${CHAT_ID}`,
                'Status: idle; last run failed',
                '',
                'user, 2026-11-18T09:00:00.000Z',
                'Fix it',
                '',
                'assistant, 2026-11-18T09:01:00.000Z',
                'Fixed.',
                '',
                `Older messages: dexto chat get ${CHAT_ID} --after 3`,
            ].join('\n')
        );
    });

    it('requires a chat id and a limit Dexto accepts', async () => {
        await expect(command('get').run(harness().context, input([]))).rejects.toThrow(
            'Missing chat_id'
        );
        await expect(
            command('get').run(harness().context, input([CHAT_ID], { limit: '51' }))
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
