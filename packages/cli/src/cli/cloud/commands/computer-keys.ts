// `workspace computers keys`: enrollment keys that let a script add computers without a browser.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    flag,
    integerOption,
    listOption,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

const SERVICES = ['computer', 'inference'] as const;
const MAX_EXPIRY_MINUTES = 30 * 24 * 60;

const KeySchema = z
    .object({
        id: z.string(),
        name: z.string(),
        services: z.array(z.string()),
        enrolledComputers: z.number(),
        maxComputers: z.number(),
        expiresAt: z.string(),
        status: z.string(),
    })
    .passthrough();

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new CommandFailure('failed', `Dexto didn't return a valid ${what}.`, null);
    return result.data;
}

function boundedOption(
    input: Parameters<Command['run']>[1],
    name: string,
    min: number,
    max: number
): number | undefined {
    const value = integerOption(input, name);
    if (value !== undefined && (value < min || value > max))
        throw new UsageError(`--${name} must be between ${min} and ${max}.`);
    return value;
}

const list: Command = {
    path: ['workspace', 'computers', 'keys', 'list'],
    summary: 'List your computer enrollment keys and how many computers each enrolled.',
    async run(context) {
        await requireLoginScopes(context, ['computers:read']);
        const result = parsed(
            z.object({ keys: z.array(KeySchema) }).passthrough(),
            await queryWorkspaceTool(context, 'dexto_computer_enrollment_keys_list', {}),
            'enrollment key list'
        );
        context.output.list({ data: result.keys }, [
            { header: 'id', value: (key) => key.id },
            { header: 'name', value: (key) => key.name },
            { header: 'services', value: (key) => key.services.join(',') },
            { header: 'enrolled', value: (key) => `${key.enrolledComputers}/${key.maxComputers}` },
            { header: 'expires', value: (key) => key.expiresAt },
            { header: 'status', value: (key) => key.status },
        ]);
    },
};

const create: Command = {
    path: ['workspace', 'computers', 'keys', 'create'],
    arguments: '<name>',
    summary:
        'Create a key that lets machines you provision join as your connected computers, without a browser. The secret prints once.',
    options: {
        service: {
            type: 'string',
            multiple: true,
            valueName: 'SERVICE',
            description:
                'computer (files and shell) or inference (local models); repeat for both, the default.',
        },
        'max-computers': {
            type: 'string',
            valueName: 'N',
            description: 'How many computers it may enroll (1-100, default 1).',
        },
        'expires-in': {
            type: 'string',
            valueName: 'MINUTES',
            description: `Minutes until it stops enrolling (5-${MAX_EXPIRY_MINUTES}, default 60).`,
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const name = argument(input, 0, 'name');
        const services = listOption(input, 'service');
        const unknown = services.filter((service) => !SERVICES.some((each) => each === service));
        if (unknown.length > 0)
            throw new UsageError(`--service must be one of: ${SERVICES.join(', ')}.`);
        const maxComputers = boundedOption(input, 'max-computers', 1, 100);
        const expiresInMinutes = boundedOption(input, 'expires-in', 5, MAX_EXPIRY_MINUTES);
        await requireLoginScopes(context, ['computers:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Create enrollment key ${name}? Anyone holding it can add a computer to your account until it expires or is used up.`
        );
        const result = parsed(
            z
                .object({ enrollmentKey: z.string(), connectCommand: z.string(), key: KeySchema })
                .passthrough(),
            await queryWorkspaceTool(context, 'dexto_computer_enrollment_key_create', {
                name,
                ...(services.length === 0 ? {} : { services: [...new Set(services)] }),
                ...(maxComputers === undefined ? {} : { maxComputers }),
                ...(expiresInMinutes === undefined ? {} : { expiresInMinutes }),
            }),
            'enrollment key'
        );
        context.output.result(
            result,
            [
                `Created enrollment key ${result.key.name} (${result.key.id}). It is shown only now; store it like a password:`,
                result.enrollmentKey,
                `On the machine, after dexto-daemon init: ${result.connectCommand}`,
            ].join('\n')
        );
    },
};

const revoke: Command = {
    path: ['workspace', 'computers', 'keys', 'revoke'],
    arguments: '<key_id>',
    summary:
        'Revoke an enrollment key so it enrolls no more computers. Computers it enrolled stay connected.',
    options: YES_OPTION,
    async run(context, input) {
        const keyId = argument(input, 0, 'key_id');
        await requireLoginScopes(context, ['computers:write']);
        await requireConsent(context, flag(input, 'yes'), `Revoke enrollment key ${keyId}?`);
        const result = parsed(
            z.object({ key: KeySchema }).passthrough(),
            await queryWorkspaceTool(context, 'dexto_computer_enrollment_key_revoke', { keyId }),
            'revoked enrollment key'
        );
        context.output.result(
            result,
            `Revoked enrollment key ${result.key.name} (${result.key.id}).`
        );
    },
};

export const computerKeyCommands: readonly Command[] = [list, create, revoke];
