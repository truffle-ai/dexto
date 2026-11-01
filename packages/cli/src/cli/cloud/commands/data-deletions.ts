// `cloud data-deletions`: delete an end user's or an agent's data in the background.

import { unwrap, type V1Response } from '@dexto/cloud-client';
import {
    argument,
    flag,
    PAGE_OPTIONS,
    pageQuery,
    requireConsent,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import type { Column } from '../output.js';

type DataDeletion = V1Response<'/v1/data_deletions', 'get'>['data'][number];

const COLUMNS: readonly Column<DataDeletion>[] = [
    { header: 'id', value: (deletion) => deletion.id },
    { header: 'status', value: (deletion) => deletion.status },
    { header: 'scope', value: (deletion) => JSON.stringify(deletion.scope) },
    { header: 'created', value: (deletion) => deletion.created_at },
];

const create: Command = {
    options: {
        agent: { description: 'The agent whose data to delete.', type: 'string', valueName: 'ID' },
        user: { description: 'The end-user label whose sessions to delete.', type: 'string' },
        ...YES_OPTION,
    },
    path: ['cloud', 'data-deletions', 'create'],
    summary:
        "Delete an end user's sessions (--user, optionally of one --agent), or all of an agent's data (--agent).",
    async run(context, input) {
        const agentId = stringOption(input, 'agent');
        const user = stringOption(input, 'user');
        if (agentId === undefined && user === undefined)
            throw new UsageError('Pass --user, --agent, or both.');
        await requireConsent(
            context,
            flag(input, 'yes'),
            user === undefined
                ? `This deletes all of agent ${agentId}'s data for good.`
                : `This deletes ${user}'s sessions${agentId === undefined ? '' : ` with agent ${agentId}`} for good.`
        );
        const deletion = await unwrap(
            await (
                await context.client()
            ).POST('/v1/data_deletions', {
                body: { agent_id: agentId ?? null, ...(user === undefined ? {} : { user }) },
            })
        );
        context.output.result(deletion, `Data deletion ${deletion.id} is ${deletion.status}.`);
    },
};

const list: Command = {
    options: PAGE_OPTIONS,
    path: ['cloud', 'data-deletions', 'list'],
    summary: 'List data deletions.',
    async run(context, input) {
        context.output.list(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/data_deletions', {
                    params: { query: pageQuery(input) },
                })
            ),
            COLUMNS
        );
    },
};

const get: Command = {
    arguments: '<data_deletion_id>',
    path: ['cloud', 'data-deletions', 'get'],
    summary: 'Show a data deletion and what it deleted.',
    async run(context, input) {
        context.output.record(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/data_deletions/{data_deletion_id}', {
                    params: {
                        path: { data_deletion_id: argument(input, 0, 'data_deletion_id') },
                    },
                })
            )
        );
    },
};

export const dataDeletionCommands: readonly Command[] = [create, list, get];
