// `workspace gigs publish`: post a Gig as yourself, over the Gigs poster tool's `publish_gig`.
// The Cloud checks the scope, validates the input and refuses a call the person didn't agree to.

import { CommandFailure } from '../../failure.js';

import {
    flag,
    listOption,
    requiredOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const TOOL = 'dexto_gigs_posting';

type PublishCall = {
    readonly action: 'publish_gig';
    readonly budget?: { readonly amountMinor: number; readonly currency: string };
    readonly contract?: { readonly options?: readonly string[]; readonly skill: string };
    readonly description: string;
    readonly tags: readonly string[];
    readonly timeline: string;
    readonly title: string;
};

const publish: Command = {
    path: ['workspace', 'gigs', 'publish'],
    summary: 'Publish a Gig as yourself, open for proposals. Asks first.',
    examples: [
        'dexto workspace gigs publish --title "Landing page" --description "Build a landing page for our launch." --timeline "Two weeks" --tag web --budget 500 --currency USD --yes --json',
        'dexto workspace gigs publish --title "Ship the site" --description "Build and deploy it." --timeline "A week" --contract-skill build-and-ship --contract-option web --yes --json',
    ],
    options: {
        title: { type: 'string', valueName: 'TEXT', description: "The Gig's title. Required." },
        description: {
            type: 'string',
            valueName: 'TEXT',
            description: 'What the work is. Required.',
        },
        timeline: {
            type: 'string',
            valueName: 'TEXT',
            description: 'When it should be done, such as "Two weeks". Required.',
        },
        tag: { type: 'string', multiple: true, valueName: 'TAG', description: 'A tag; repeat it.' },
        budget: {
            type: 'string',
            valueName: 'AMOUNT',
            description:
                'An informational budget, such as 500 or 499.99, with --currency. Gigs takes no payment.',
        },
        currency: {
            type: 'string',
            valueName: 'CODE',
            description: "The budget's currency, such as USD.",
        },
        'contract-skill': {
            type: 'string',
            valueName: 'SLUG',
            description: 'Post under this contract skill, such as build-and-ship.',
        },
        'contract-option': {
            type: 'string',
            multiple: true,
            valueName: 'ID',
            description:
                "A contract option id wanted, such as web; repeat it. Omit for the skill's defaults.",
        },
        'dry-run': {
            type: 'boolean',
            description: 'Show what would be published without sending anything to Dexto.',
        },
        ...YES_OPTION,
    },
    async run(context, input) {
        const call = publishCall(input);
        if (flag(input, 'dry-run')) {
            const message = 'Nothing was sent, so Dexto checked nothing.';
            context.output.result(
                { dryRun: true, checkedByDexto: false, tool: TOOL, arguments: call, message },
                `Would publish the Gig "${call.title}" with ${JSON.stringify(call)}. ${message}`
            );
            return;
        }
        await context.connection({ pin: true });
        await requireLoginScopes(context, ['gigs:write']);
        const tool = (await listWorkspaceTools(context)).find((each) => each.name === TOOL);
        if (tool === undefined)
            throw new CommandFailure('failed', "This Dexto can't publish Gigs yet.", null);
        const agreed = await agreeToCall(
            context,
            {
                level: toolCallLevel(tool, call),
                schema: tool.inputSchema,
                title: `Publish the Gig "${call.title}" for anyone to see and send proposals on`,
            },
            flag(input, 'yes')
        );
        context.output.record(await queryWorkspaceTool(context, TOOL, { ...call, ...agreed }));
    },
};

/** The `publish_gig` input the options name; the Cloud checks lengths, tags and the contract. */
function publishCall(input: CommandInput): PublishCall {
    const skill = stringOption(input, 'contract-skill');
    const options = listOption(input, 'contract-option');
    if (skill === undefined && options.length > 0)
        throw new UsageError('--contract-option needs --contract-skill.');
    const budget = budgetOption(input);
    return {
        action: 'publish_gig',
        ...(budget === undefined ? {} : { budget }),
        ...(skill === undefined
            ? {}
            : { contract: { skill, ...(options.length === 0 ? {} : { options }) } }),
        description: requiredOption(input, 'description'),
        tags: listOption(input, 'tag'),
        timeline: requiredOption(input, 'timeline'),
        title: requiredOption(input, 'title'),
    };
}

/** `--budget` in the currency's own units, as the minor units the Cloud takes. */
function budgetOption(input: CommandInput): PublishCall['budget'] {
    const amount = stringOption(input, 'budget');
    const currency = stringOption(input, 'currency')?.toUpperCase();
    if (amount === undefined && currency === undefined) return undefined;
    if (amount === undefined || currency === undefined)
        throw new UsageError('--budget and --currency go together.');
    if (!/^[A-Z]{3}$/u.test(currency))
        throw new UsageError('--currency must be a three-letter code, such as USD.');
    const digits =
        new Intl.NumberFormat('en', { currency, style: 'currency' }).resolvedOptions()
            .maximumFractionDigits ?? 2;
    const parts = /^(\d+)(?:\.(\d+))?$/u.exec(amount);
    if (parts?.[1] === undefined || (parts[2] ?? '').length > digits)
        throw new UsageError(
            digits === 0
                ? `--budget must be a whole number of ${currency}.`
                : `--budget must be an amount such as 500 or 499.${'9'.repeat(digits)}.`
        );
    const amountMinor = Number(`${parts[1]}${(parts[2] ?? '').padEnd(digits, '0')}`);
    if (amountMinor === 0) throw new UsageError('--budget must be more than zero.');
    return { amountMinor, currency };
}

export const gigPublishCommands: readonly Command[] = [publish];
