// Synthetic Claude Code and Codex transcripts the import tests share.

import path from 'node:path';

export const jsonl = (lines: readonly unknown[]) =>
    lines.map((line) => JSON.stringify(line)).join('\n');

/** A synthetic Claude Code session, shaped as the Agent SDK's messages. */
export function claudeSession(sessionId: string) {
    const base = {
        cwd: '/work/api',
        gitBranch: 'main',
        isSidechain: false,
        sessionId,
        version: '2.1.0',
    };
    return jsonl([
        { leafUuid: 'a3', summary: 'Fix the flaky login test', type: 'summary' },
        {
            ...base,
            isMeta: true,
            message: { content: 'Caveat: local commands below.', role: 'user' },
            timestamp: '2026-10-01T10:00:00.000Z',
            type: 'user',
            uuid: 'm0',
        },
        {
            ...base,
            message: { content: '<command-name>/clear</command-name>', role: 'user' },
            timestamp: '2026-10-01T10:00:01.000Z',
            type: 'user',
            uuid: 'm1',
        },
        {
            ...base,
            message: { content: 'Why does login.test.ts fail?', role: 'user' },
            timestamp: '2026-10-01T10:00:02.000Z',
            type: 'user',
            uuid: 'u1',
        },
        {
            ...base,
            message: {
                content: [
                    { thinking: 'Let me look.', type: 'thinking' },
                    { text: 'Let me run it.', type: 'text' },
                ],
                id: 'msg_1',
                role: 'assistant',
            },
            timestamp: '2026-10-01T10:00:03.000Z',
            type: 'assistant',
            uuid: 'a1',
        },
        {
            ...base,
            message: {
                content: [
                    {
                        id: 'toolu_1',
                        input: { command: 'pnpm test login' },
                        name: 'Bash',
                        type: 'tool_use',
                    },
                ],
                id: 'msg_1',
                role: 'assistant',
            },
            timestamp: '2026-10-01T10:00:04.000Z',
            type: 'assistant',
            uuid: 'a2',
        },
        {
            ...base,
            message: {
                content: [
                    {
                        content: 'FAIL login.test.ts\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx',
                        tool_use_id: 'toolu_1',
                        type: 'tool_result',
                    },
                ],
                role: 'user',
            },
            timestamp: '2026-10-01T10:00:05.000Z',
            type: 'user',
            uuid: 'r1',
        },
        {
            ...base,
            isSidechain: true,
            message: { content: [{ text: 'Subagent noise', type: 'text' }], role: 'assistant' },
            timestamp: '2026-10-01T10:00:06.000Z',
            type: 'assistant',
            uuid: 's1',
        },
        {
            ...base,
            message: {
                content: [{ text: 'The test races the clock.', type: 'text' }],
                id: 'msg_2',
                role: 'assistant',
            },
            timestamp: '2026-10-01T10:00:07.000Z',
            type: 'assistant',
            uuid: 'a3',
        },
        { snapshot: {}, type: 'file-history-snapshot' },
        'not json',
    ]);
}

/** A synthetic Codex rollout, shaped as `RolloutItemWire` lines. */
export function codexRollout(id: string) {
    return jsonl([
        {
            payload: {
                cli_version: '0.50.0',
                cwd: '/work/web',
                git: { branch: 'feature/x', commit_hash: 'abc' },
                id,
                originator: 'codex_cli_rs',
                timestamp: '2026-10-02T09:00:00.000Z',
            },
            timestamp: '2026-10-02T09:00:00.000Z',
            type: 'session_meta',
        },
        {
            payload: {
                content: [{ text: 'You are Codex.', type: 'input_text' }],
                role: 'developer',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:00.100Z',
            type: 'response_item',
        },
        {
            payload: {
                content: [
                    {
                        text: '<environment_context>\n  <cwd>/work/web</cwd>\n</environment_context>',
                        type: 'input_text',
                    },
                ],
                role: 'user',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:00.200Z',
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: 'List the routes.', type: 'input_text' }],
                role: 'user',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:01.000Z',
            type: 'response_item',
        },
        {
            payload: { content: null, encrypted_content: 'x', summary: [], type: 'reasoning' },
            timestamp: '2026-10-02T09:00:02.000Z',
            type: 'response_item',
        },
        {
            payload: {
                arguments: '{"command":["rg","route"]}',
                call_id: 'call_1',
                name: 'shell',
                type: 'function_call',
            },
            timestamp: '2026-10-02T09:00:03.000Z',
            type: 'response_item',
        },
        {
            payload: { call_id: 'call_1', output: 'src/routes.ts', type: 'function_call_output' },
            timestamp: '2026-10-02T09:00:04.000Z',
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'call_2',
                input: '*** Begin Patch',
                name: 'apply_patch',
                type: 'custom_tool_call',
            },
            timestamp: '2026-10-02T09:00:05.000Z',
            type: 'response_item',
        },
        {
            payload: {
                call_id: 'call_2',
                output: [{ text: 'Done.', type: 'input_text' }],
                type: 'custom_tool_call_output',
            },
            timestamp: '2026-10-02T09:00:06.000Z',
            type: 'response_item',
        },
        {
            payload: {
                content: [{ text: 'One route: /health.', type: 'output_text' }],
                role: 'assistant',
                type: 'message',
            },
            timestamp: '2026-10-02T09:00:07.000Z',
            type: 'response_item',
        },
        {
            payload: { message: 'ignored', type: 'agent_message' },
            timestamp: '2026-10-02T09:00:08.000Z',
            type: 'event_msg',
        },
    ]);
}

/** A Codex `state_5.sqlite` with the `threads` columns an import reads, holding these rows. */
export async function writeCodexState(
    home: string,
    threads: readonly {
        readonly archived?: boolean;
        readonly cwd: string;
        readonly id: string;
        readonly name?: string | null;
        readonly rolloutPath: string | null;
        readonly title: string;
        readonly updatedAt: string;
    }[]
): Promise<void> {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(home, 'state_5.sqlite'));
    try {
        db.exec(
            'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, name TEXT)'
        );
        const insert = db.prepare(
            'INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, archived, name) VALUES (?, ?, 0, ?, ?, ?, ?, ?)'
        );
        for (const thread of threads)
            insert.run(
                thread.id,
                thread.rolloutPath,
                Math.floor(new Date(thread.updatedAt).getTime() / 1_000),
                thread.cwd,
                thread.title,
                thread.archived === true ? 1 : 0,
                thread.name ?? null
            );
    } finally {
        db.close();
    }
}
