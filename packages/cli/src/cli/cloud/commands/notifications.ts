import { z } from 'zod';
import {
    argument,
    flag,
    integerOption,
    PAGE_OPTIONS,
    stringOption,
    UsageError,
    type Command,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const NotificationSchema = z
    .object({
        id: z.string(),
        title: z.string(),
        body: z.string().nullable(),
        kind: z.string(),
        source: z.string(),
        severity: z.string(),
        createdAt: z.string(),
        readAt: z.string().nullable(),
    })
    .passthrough();
const PageSchema = z.object({
    notifications: z.array(NotificationSchema),
    nextCursor: z.string().nullable(),
});
const ReadSchema = z.object({ notification: NotificationSchema }).passthrough();
const MarkedSchema = z.object({ marked: z.array(z.string()) }).passthrough();

const list: Command = {
    options: {
        ...PAGE_OPTIONS,
        limit: {
            description: 'How many to return, 1 to 50 (default 20).',
            type: 'string',
            valueName: 'N',
        },
        unread: { description: 'Only notifications you have not read.', type: 'boolean' },
    },
    path: ['notifications', 'list'],
    examples: [
        'dexto notifications list --unread --json',
        'dexto notifications list --after "$CURSOR"',
    ],
    summary: 'List your notifications, newest first.',
    async run(context, input) {
        const limit = integerOption(input, 'limit');
        if (limit !== undefined && (limit < 1 || limit > 50))
            throw new UsageError('--limit must be between 1 and 50.');
        const cursor = stringOption(input, 'after');
        await requireLoginScopes(context, ['notifications:read']);
        const page = PageSchema.parse(
            await queryWorkspaceTool(context, 'dexto_notifications_list', {
                unreadOnly: flag(input, 'unread'),
                ...(limit === undefined ? {} : { limit }),
                ...(cursor === undefined ? {} : { cursor }),
            })
        );
        context.output.list(
            {
                data: page.notifications,
                has_more: page.nextCursor !== null,
                next_after: page.nextCursor,
            },
            [
                { header: 'id', value: (notification) => notification.id },
                { header: 'unread', value: (notification) => (notification.readAt ? '' : 'yes') },
                { header: 'title', value: (notification) => notification.title },
                { header: 'created', value: (notification) => notification.createdAt },
            ]
        );
    },
};

const get: Command = {
    arguments: '<notification_id>',
    path: ['notifications', 'get'],
    summary: 'Read one notification without marking it read.',
    examples: ['dexto notifications get "$NOTIFICATION_ID" --json'],
    async run(context, input) {
        const notificationId = argument(input, 0, 'notification_id');
        await requireLoginScopes(context, ['notifications:read']);
        const result = ReadSchema.parse(
            await queryWorkspaceTool(context, 'dexto_notification_get', { notificationId })
        );
        const { notification } = result;
        context.output.result(
            result,
            [
                notification.title,
                notification.body,
                `${notification.createdAt} ${notification.readAt ? 'read' : 'unread'}`,
            ]
                .filter((line) => line !== null)
                .join('\n')
        );
    },
};

const markRead: Command = {
    arguments: '<notification_id...>',
    path: ['notifications', 'mark-read'],
    summary: 'Mark notifications read by id; ids that are not yours are ignored.',
    examples: ['dexto notifications mark-read "$NOTIFICATION_ID" --json'],
    async run(context, input) {
        const notificationIds = [...input.positionals];
        if (notificationIds.length === 0) throw new UsageError('Missing notification_id.');
        if (notificationIds.length > 50)
            throw new UsageError('Mark at most 50 notifications read at once.');
        await requireLoginScopes(context, ['notifications:write']);
        const result = MarkedSchema.parse(
            await queryWorkspaceTool(context, 'dexto_notifications_mark_read', { notificationIds })
        );
        context.output.result(result, `Marked ${result.marked.length} read.`);
    },
};

export const notificationCommands: readonly Command[] = [list, get, markRead];
