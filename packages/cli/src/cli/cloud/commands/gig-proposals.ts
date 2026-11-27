// `workspace gigs propose` and `workspace gigs withdraw`: send or take back your proposal on a
// Gig, over the Gigs finding tool's submit_bid and withdraw_bid actions.

import { z } from 'zod';

import { CommandFailure } from '../../failure.js';
import {
    argument,
    flag,
    integerOption,
    requiredOption,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

const TOOL = 'dexto_gigs_finding';

const BidReplySchema = z
    .object({
        bid: z
            .object({
                gig: z.object({ title: z.string() }).passthrough(),
                id: z.string(),
                status: z.string(),
            })
            .passthrough()
            .nullable(),
    })
    .passthrough();

/** `--price` and `--currency` together, as the Gigs money shape; neither leaves the price out. */
function priceOf(input: CommandInput): { price?: { amountMinor: number; currency: string } } {
    const amountMinor = integerOption(input, 'price');
    const currency = stringOption(input, 'currency');
    if (amountMinor === undefined && currency === undefined) return {};
    if (amountMinor === undefined || currency === undefined)
        throw new UsageError('Pass --price and --currency together.');
    return { price: { amountMinor, currency } };
}

/** Calls one finding action once the person agreed as its level asks; prints the proposal. */
async function changeProposal(
    context: CommandContext,
    call: Record<string, unknown>,
    title: string,
    yes: boolean
): Promise<void> {
    await requireLoginScopes(context, ['gigs:write']);
    const tool = (await listWorkspaceTools(context)).find((each) => each.name === TOOL);
    if (tool === undefined)
        throw new CommandFailure('failed', "This Dexto can't send Gig proposals yet.", null);
    const agreed = await agreeToCall(
        context,
        { level: toolCallLevel(tool, call), schema: tool.inputSchema, title },
        yes
    );
    const value = await queryWorkspaceTool(context, TOOL, { ...call, ...agreed });
    const { bid } = BidReplySchema.parse(value);
    if (bid === null) throw new CommandFailure('failed', "Dexto didn't return the proposal.", null);
    context.output.result(value, `Proposal ${bid.id} on "${bid.gig.title}" is ${bid.status}.`);
}

const propose: Command = {
    arguments: '<gig_id>',
    examples: [
        'dexto workspace gigs propose GIG_ID --approach "Audit, then fix" --delivery "3 days" --yes --json',
        'dexto workspace gigs propose GIG_ID --approach "Port it" --delivery "1 week" --price 50000 --currency USD',
    ],
    options: {
        approach: {
            description: 'How you would do the work, as the poster reads it.',
            type: 'string',
            valueName: 'TEXT',
        },
        delivery: {
            description: 'When you would deliver, such as "3 days".',
            type: 'string',
            valueName: 'TEXT',
        },
        price: {
            description:
                'Your price in minor units, such as 50000 for $500.00; needs --currency. Gigs does not process payment.',
            type: 'string',
            valueName: 'AMOUNT',
        },
        currency: {
            description: 'The price currency, such as USD; needs --price.',
            type: 'string',
            valueName: 'CODE',
        },
        ...YES_OPTION,
    },
    path: ['workspace', 'gigs', 'propose'],
    summary:
        'Send your proposal on a Gig: your approach, a delivery estimate and an optional price. Asks first.',
    async run(context, input) {
        const gigId = argument(input, 0, 'gig_id');
        const call = {
            action: 'submit_bid',
            approach: requiredOption(input, 'approach'),
            deliveryEstimate: requiredOption(input, 'delivery'),
            gigId,
            ...priceOf(input),
        };
        await changeProposal(context, call, `Send a proposal on Gig ${gigId}`, flag(input, 'yes'));
    },
};

const withdraw: Command = {
    arguments: '<bid_id>',
    examples: ['dexto workspace gigs withdraw BID_ID --yes --json'],
    options: YES_OPTION,
    path: ['workspace', 'gigs', 'withdraw'],
    summary: 'Take back a proposal you sent, by its proposal id. Asks first.',
    async run(context, input) {
        const bidId = argument(input, 0, 'bid_id');
        await changeProposal(
            context,
            { action: 'withdraw_bid', bidId },
            `Withdraw proposal ${bidId}`,
            flag(input, 'yes')
        );
    },
};

export const gigProposalCommands: readonly Command[] = [propose, withdraw];
