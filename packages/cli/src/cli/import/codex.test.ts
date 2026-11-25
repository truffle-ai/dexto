/** Verifies how a Codex rollout and its state database read into a chat. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCodexRollout, readCodexThreads } from './codex.js';
import { codexRollout, jsonl, writeCodexState } from './test-utils.js';

describe('parseCodexRollout', () => {
    it('reads the session meta, leaves out developer and injected context, and renders tools', () => {
        const chat = parseCodexRollout(codexRollout('thread-1'), '/x/rollout.jsonl', () => null);

        expect(chat).toMatchObject({
            cwd: '/work/web',
            gitBranch: 'feature/x',
            id: 'thread-1',
            source: 'codex',
            startedAt: '2026-10-02T09:00:01.000Z',
            title: 'List the routes.',
            updatedAt: '2026-10-02T09:00:07.000Z',
        });
        expect(chat?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
        const answer = chat?.messages[1]?.text ?? '';
        expect(answer).toContain('**Tool call: shell**');
        expect(answer).toContain('"rg"');
        expect(answer).toContain('src/routes.ts');
        expect(answer).toContain('**Tool call: apply_patch**');
        expect(answer).toContain('Done.');
        expect(answer).toContain('One route: /health.');
        expect(answer).not.toContain('You are Codex.');
        expect(answer).not.toContain('environment_context');
    });
});

describe('Codex models', () => {
    const at = (second: number) => `2026-11-01T10:00:${String(second).padStart(2, '0')}.000Z`;
    const say = (role: 'assistant' | 'user', text: string, second: number) => ({
        payload: {
            content: [{ text, type: role === 'user' ? 'input_text' : 'output_text' }],
            role,
            type: 'message',
        },
        timestamp: at(second),
        type: 'response_item',
    });
    const context = (payload: Record<string, unknown>, second: number) => ({
        payload: { cwd: '/w', ...payload },
        timestamp: at(second),
        type: 'turn_context',
    });

    it('gives each answer the model and effort of the turn_context before it', () => {
        const chat = parseCodexRollout(
            jsonl([
                { payload: { id: 't' }, timestamp: at(0), type: 'session_meta' },
                say('user', 'First question', 1),
                context({ effort: 'high', model: 'gpt-6.1-sol' }, 2),
                say('assistant', 'First answer', 3),
                say('user', 'Second question', 4),
                context({ effort: 'low', model: 'gpt-5.5' }, 5),
                {
                    payload: {
                        arguments: '{}',
                        call_id: 'c',
                        name: 'shell',
                        type: 'function_call',
                    },
                    timestamp: at(6),
                    type: 'response_item',
                },
                say('assistant', 'Second answer', 7),
                say('user', 'Third question', 8),
                context({ model: 'gpt-5.5' }, 9),
                say('assistant', 'Third answer', 10),
            ]),
            '/x/t.jsonl',
            () => null
        );

        expect(
            chat?.messages.map((message) =>
                message.role === 'assistant'
                    ? { model: message.model, reasoningEffort: message.reasoningEffort }
                    : message.role
            )
        ).toEqual([
            'user',
            { model: 'gpt-6.1-sol', reasoningEffort: 'high' },
            'user',
            { model: 'gpt-5.5', reasoningEffort: 'low' },
            'user',
            { model: 'gpt-5.5', reasoningEffort: undefined },
        ]);
    });

    it('gives a merged answer the model in force for its last part', () => {
        const chat = parseCodexRollout(
            jsonl([
                { payload: { id: 't' }, timestamp: at(0), type: 'session_meta' },
                say('user', 'Question', 1),
                context({ effort: 'high', model: 'gpt-6.1-sol' }, 2),
                say('assistant', 'Working', 3),
                context({ effort: 'xhigh', model: 'gpt-6.1-sol-max' }, 4),
                say('assistant', 'Done', 5),
            ]),
            '/x/t.jsonl',
            () => null
        );

        expect(chat?.messages[1]).toEqual({
            createdAt: at(3),
            model: 'gpt-6.1-sol-max',
            reasoningEffort: 'xhigh',
            role: 'assistant',
            text: 'Working\n\nDone',
        });
    });

    it('sends no model or effort the import would refuse', () => {
        const chat = parseCodexRollout(
            jsonl([
                { payload: { id: 't' }, timestamp: at(0), type: 'session_meta' },
                say('user', 'Question', 1),
                context({ effort: 'Very High', model: 'gpt-5.5' }, 2),
                say('assistant', 'One', 3),
                say('user', 'Again', 4),
                context({ effort: 'high', model: 'bad\u0007model' }, 5),
                say('assistant', 'Two', 6),
            ]),
            '/x/t.jsonl',
            () => null
        );

        expect(chat?.messages[1]).toMatchObject({ model: 'gpt-5.5' });
        expect(chat?.messages[1]).not.toHaveProperty('reasoningEffort');
        expect(chat?.messages[3]).not.toHaveProperty('model');
    });
});

describe('readCodexThreads', () => {
    it('reads titles, which threads lost their rollout, and leaves out archived ones', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'codex-state-'));
        const kept = path.join(home, 'rollout-a.jsonl');
        await writeFile(kept, '');
        await writeCodexState(home, [
            {
                cwd: '/w',
                id: 'a',
                name: 'Renamed',
                rolloutPath: kept,
                title: 'Auto',
                updatedAt: '2026-11-01T00:00:00Z',
            },
            {
                cwd: '/w',
                id: 'b',
                rolloutPath: path.join(home, 'gone.jsonl'),
                title: 'Auto b',
                updatedAt: '2026-11-02T00:00:00Z',
            },
            {
                cwd: '/w',
                id: 'c',
                rolloutPath: kept,
                title: '  ',
                updatedAt: '2026-11-03T00:00:00Z',
            },
            {
                archived: true,
                cwd: '/w',
                id: 'd',
                rolloutPath: kept,
                title: 'Old',
                updatedAt: '2026-11-04T00:00:00Z',
            },
        ]);

        expect(await readCodexThreads(home)).toEqual([
            {
                cwd: '/w',
                hasRollout: true,
                id: 'a',
                title: 'Renamed',
                updatedAt: '2026-11-01T00:00:00.000Z',
            },
            {
                cwd: '/w',
                hasRollout: false,
                id: 'b',
                title: 'Auto b',
                updatedAt: '2026-11-02T00:00:00.000Z',
            },
            {
                cwd: '/w',
                hasRollout: true,
                id: 'c',
                title: null,
                updatedAt: '2026-11-03T00:00:00.000Z',
            },
        ]);
    });

    it('reports an unreadable state database instead of silently losing titles and migration notices', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'codex-state-'));
        expect(await readCodexThreads(home)).toBeNull();
        await writeFile(path.join(home, 'state_5.sqlite'), 'not a database');
        await expect(readCodexThreads(home)).rejects.toThrow('--dir');
        await expect(readCodexThreads(home)).rejects.toHaveProperty('cause');
    });
});
