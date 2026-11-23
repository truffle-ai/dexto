import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeFailure, type CommandContext } from '../command.js';
import { notificationCommands } from './notifications.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', () => ({ queryWorkspaceTool: query }));

const [list, get, markRead] = notificationCommands;
const notification = {
    id: '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80',
    title: 'Chat finished',
    body: 'Your report is ready.',
    kind: 'session.completed',
    source: 'system',
    severity: 'success',
    createdAt: '2026-11-18T10:00:00.000Z',
    readAt: null,
    action: null,
    appId: null,
    dedupeKey: null,
    metadata: {},
};

function contextWith(scopes: readonly string[]) {
    const output = { list: vi.fn(), result: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        output,
        overrides: { profile: null },
        runtime: { environment: {}, prompt: null },
    } as unknown as CommandContext;
    return { context, output };
}

beforeEach(() => query.mockReset());

describe('dexto notifications', () => {
    it('registers list, get and mark-read', () => {
        expect(notificationCommands.map((command) => command.path.join(' '))).toEqual([
            'notifications list',
            'notifications get',
            'notifications mark-read',
        ]);
    });

    it('lists unread notifications a page at a time with the next cursor', async () => {
        const { context, output } = contextWith(['notifications:read']);
        query.mockResolvedValueOnce({
            notifications: [notification],
            nextCursor: 'next',
            untrustedContent: true,
        });
        await list?.run(context, {
            positionals: [],
            values: { unread: true, limit: '5', after: 'cursor' },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_notifications_list', {
            unreadOnly: true,
            limit: 5,
            cursor: 'cursor',
        });
        expect(output.list).toHaveBeenCalledWith(
            { data: [notification], has_more: true, next_after: 'next' },
            expect.any(Array)
        );
    });

    it('lists everything by default and rejects an out-of-range limit before calling', async () => {
        const { context, output } = contextWith(['notifications:read']);
        query.mockResolvedValueOnce({ notifications: [], nextCursor: null });
        await list?.run(context, { positionals: [], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_notifications_list', {
            unreadOnly: false,
        });
        expect(output.list).toHaveBeenCalledWith(
            { data: [], has_more: false, next_after: null },
            expect.any(Array)
        );
        await expect(
            list?.run(context, { positionals: [], values: { limit: '51' } })
        ).rejects.toThrow('--limit must be between 1 and 50');
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('reads one notification with the read tool only, never marking it read', async () => {
        const { context, output } = contextWith(['notifications:read']);
        const value = { notification, untrustedContent: true };
        query.mockResolvedValueOnce(value);
        await get?.run(context, { positionals: [notification.id], values: {} });
        expect(query).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(context, 'dexto_notification_get', {
            notificationId: notification.id,
        });
        expect(output.result).toHaveBeenCalledWith(
            value,
            'Chat finished\nYour report is ready.\n2026-11-18T10:00:00.000Z unread'
        );
    });

    it('marks exactly the given ids read and prints only the ids the server marked', async () => {
        const { context, output } = contextWith(['notifications:write']);
        const foreign = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
        query.mockResolvedValueOnce({ marked: [notification.id] });
        await markRead?.run(context, { positionals: [notification.id, foreign], values: {} });
        expect(query).toHaveBeenCalledWith(context, 'dexto_notifications_mark_read', {
            notificationIds: [notification.id, foreign],
        });
        expect(output.result).toHaveBeenCalledWith({ marked: [notification.id] }, 'Marked 1 read.');
    });

    it('needs at least one and at most 50 ids to mark read', async () => {
        const { context } = contextWith(['notifications:write']);
        await expect(markRead?.run(context, { positionals: [], values: {} })).rejects.toThrow(
            'Missing notification_id.'
        );
        await expect(
            markRead?.run(context, { positionals: Array(51).fill(notification.id), values: {} })
        ).rejects.toThrow('at most 50');
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for notifications:read to list or read, and notifications:write to mark read', async () => {
        const { context } = contextWith(['notifications:read']);
        await expect(
            markRead?.run(context, { positionals: [notification.id], values: {} })
        ).rejects.toMatchObject({ scopes: ['notifications:write'] });
        const none = contextWith([]).context;
        await expect(list?.run(none, { positionals: [], values: {} })).rejects.toBeInstanceOf(
            MissingScopeFailure
        );
        await expect(
            get?.run(none, { positionals: [notification.id], values: {} })
        ).rejects.toMatchObject({ scopes: ['notifications:read'] });
        expect(query).not.toHaveBeenCalled();
    });
});
