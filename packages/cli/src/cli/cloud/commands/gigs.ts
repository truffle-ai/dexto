// `workspace gigs`: search and read Dexto Gigs as yourself, over the read actions of the Gigs tools.
// Every write (publish, bid, message, terms, delivery) stays a workspace operation that asks first.

import { CommandFailure } from '../../failure.js';

import { z } from 'zod';

import { argument, type Command, type CommandContext, type CommandInput } from '../command.js';
import type { Column } from '../output.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool } from './workspace.js';

/** Each read action, by the Gigs tool that takes it: the poster's side or the doer's. */
const READ_ACTION_TOOLS = {
    get_gig: 'dexto_gigs_finding',
    get_match: 'dexto_gigs_finding',
    list_gig_bids: 'dexto_gigs_posting',
    list_my_bids: 'dexto_gigs_finding',
    list_posted_gigs: 'dexto_gigs_posting',
    read_thread: 'dexto_gigs_finding',
    search_gigs: 'dexto_gigs_finding',
} as const;

type ReadCall =
    | { readonly action: 'list_my_bids' | 'list_posted_gigs' }
    | { readonly action: 'search_gigs'; readonly query?: string }
    | {
          readonly action: 'get_gig' | 'get_match' | 'list_gig_bids' | 'read_thread';
          readonly gigId: string;
      };

const MoneySchema = z.object({ amountMinor: z.number(), currency: z.string() }).nullable();
const PersonSchema = z.object({ displayName: z.string(), handle: z.string().nullable() });
const GigSchema = z.object({
    budget: MoneySchema,
    createdAt: z.string(),
    id: z.string(),
    poster: PersonSchema,
    status: z.string(),
    tags: z.array(z.string()),
    title: z.string(),
    updatedAt: z.string(),
});
const ProposalSchema = z.object({
    deliveryEstimate: z.string(),
    doer: PersonSchema,
    id: z.string(),
    price: MoneySchema,
    status: z.string(),
});
const MyBidSchema = z.object({
    gig: z.object({ id: z.string(), title: z.string() }),
    id: z.string(),
    price: MoneySchema,
    status: z.string(),
    updatedAt: z.string(),
});

const SearchSchema = z.object({ gigs: z.array(GigSchema), limit: z.number() });
const PostedSchema = z.object({ gigs: z.array(GigSchema) });
const ProposalsSchema = z.object({ bids: z.array(ProposalSchema).nullable() });
const MyBidsSchema = z.object({ bids: z.array(MyBidSchema) });

type Gig = z.output<typeof GigSchema>;

const GIG_COLUMNS: readonly Column<Gig>[] = [
    { header: 'id', value: (gig) => gig.id },
    { header: 'title', value: (gig) => gig.title },
    { header: 'status', value: (gig) => gig.status },
    { header: 'budget', value: (gig) => money(gig.budget) },
    { header: 'tags', value: (gig) => gig.tags.join(', ') },
    { header: 'poster', value: (gig) => person(gig.poster) },
];

const search: Command = {
    arguments: '[query...]',
    path: ['workspace', 'gigs', 'search'],
    summary: 'Search open Gigs, newest first; with no query, the newest open Gigs.',
    async run(context, input) {
        const query = input.positionals.join(' ').trim();
        const value = await readGigs(context, {
            action: 'search_gigs',
            ...(query === '' ? {} : { query }),
        });
        if (context.output.json) return context.output.record(value);
        const page = SearchSchema.parse(value);
        context.output.list({ data: page.gigs }, GIG_COLUMNS);
        if (page.gigs.length >= page.limit)
            context.output.note(
                `Showing the first ${page.limit} matches; add words to narrow the search.`
            );
    },
};

const get: Command = {
    arguments: '<gig_id>',
    path: ['workspace', 'gigs', 'get'],
    summary: 'Show one Gig you can see: an open one, or one you posted or matched on.',
    async run(context, input) {
        await showOne(
            context,
            input,
            'get_gig',
            'gig',
            (gigId) => `There is no Gig ${gigId} you can see.`
        );
    },
};

const posted: Command = {
    path: ['workspace', 'gigs', 'posted'],
    summary: 'List the Gigs you posted, newest first.',
    async run(context) {
        const value = await readGigs(context, { action: 'list_posted_gigs' });
        if (context.output.json) return context.output.record(value);
        context.output.list({ data: PostedSchema.parse(value).gigs }, GIG_COLUMNS);
    },
};

const proposals: Command = {
    arguments: '<gig_id>',
    path: ['workspace', 'gigs', 'proposals'],
    summary: 'List the proposals on a Gig you posted.',
    async run(context, input) {
        const gigId = argument(input, 0, 'gig_id');
        const value = await readGigs(context, { action: 'list_gig_bids', gigId });
        const { bids } = ProposalsSchema.parse(value);
        if (bids === null)
            throw new CommandFailure('not_found', `You posted no Gig ${gigId}.`, null);
        if (context.output.json) return context.output.record(value);
        context.output.list({ data: bids }, [
            { header: 'id', value: (bid) => bid.id },
            { header: 'from', value: (bid) => person(bid.doer) },
            { header: 'status', value: (bid) => bid.status },
            { header: 'price', value: (bid) => money(bid.price) },
            { header: 'delivery', value: (bid) => bid.deliveryEstimate },
        ]);
    },
};

const bids: Command = {
    path: ['workspace', 'gigs', 'bids'],
    summary: 'List the proposals you sent, newest first.',
    async run(context) {
        const value = await readGigs(context, { action: 'list_my_bids' });
        if (context.output.json) return context.output.record(value);
        context.output.list({ data: MyBidsSchema.parse(value).bids }, [
            { header: 'id', value: (bid) => bid.id },
            { header: 'gig', value: (bid) => bid.gig.id },
            { header: 'title', value: (bid) => bid.gig.title },
            { header: 'status', value: (bid) => bid.status },
            { header: 'price', value: (bid) => money(bid.price) },
            { header: 'updated', value: (bid) => bid.updatedAt },
        ]);
    },
};

const match: Command = {
    arguments: '<gig_id>',
    path: ['workspace', 'gigs', 'match'],
    summary: 'Show your match on a Gig: its terms and delivery; --json adds its history.',
    async run(context, input) {
        await showOne(
            context,
            input,
            'get_match',
            'match',
            (gigId) => `You have no match on Gig ${gigId}.`
        );
    },
};

const thread: Command = {
    arguments: '<gig_id>',
    path: ['workspace', 'gigs', 'thread'],
    summary: 'Read the conversation on a Gig you matched on.',
    async run(context, input) {
        await showOne(
            context,
            input,
            'read_thread',
            'thread',
            (gigId) => `You have no conversation on Gig ${gigId}.`
        );
    },
};

/** One read action of a Gigs tool, as the person: every one needs `gigs:read`. */
async function readGigs(context: CommandContext, call: ReadCall): Promise<unknown> {
    await requireLoginScopes(context, ['gigs:read']);
    return await queryWorkspaceTool(context, READ_ACTION_TOOLS[call.action], call);
}

/**
 * Reads one thing a Gig id names and shows it, or fails `not_found` when the reply has none; JSON
 * prints the whole reply, its content notice included.
 */
async function showOne(
    context: CommandContext,
    input: CommandInput,
    action: 'get_gig' | 'get_match' | 'read_thread',
    key: 'gig' | 'match' | 'thread',
    missing: (gigId: string) => string
): Promise<void> {
    const gigId = argument(input, 0, 'gig_id');
    const value = await readGigs(context, { action, gigId });
    const shown = z.object({ [key]: z.unknown() }).parse(value)[key];
    if (shown === null) throw new CommandFailure('not_found', missing(gigId), null);
    context.output.record(context.output.json ? value : shown);
}

function person(value: z.output<typeof PersonSchema>): string {
    return value.handle === null ? value.displayName : `${value.displayName} (@${value.handle})`;
}

/** An informational amount in its currency's own units; Gigs never takes payment. */
function money(value: z.output<typeof MoneySchema>): string {
    if (value === null) return '';
    const format = new Intl.NumberFormat('en', { currency: value.currency, style: 'currency' });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(value.amountMinor / 10 ** digits);
}

export const gigCommands: readonly Command[] = [
    search,
    get,
    posted,
    proposals,
    bids,
    match,
    thread,
];
