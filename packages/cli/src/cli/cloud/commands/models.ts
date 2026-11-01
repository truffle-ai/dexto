// `cloud models`: every model call, text or media, as a model id and its input.

import { randomUUID } from 'node:crypto';
import { unwrap, type CloudClient, type V1Response } from '@dexto/cloud-client';
import {
    argument,
    BODY_OPTIONS,
    CommandFailure,
    flag,
    isJsonObject,
    PAGE_OPTIONS,
    pageQuery,
    readJsonBody,
    requireConsent,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import type { Column } from '../output.js';

const KINDS = ['text', 'image', 'video', 'audio', 'file'] as const;

type TextModel = V1Response<'/v1/models', 'get'>['data'][number];
type MediaModel = V1Response<'/v1/media/models', 'get'>['data'][number];
type MediaRun = V1Response<'/v1/media/generations/{generation_id}', 'get'>;

/** One model of either catalog, by the kind of output it makes. */
type CatalogModel =
    | { readonly id: string; readonly kind: 'text'; readonly text: TextModel }
    | { readonly id: string; readonly kind: MediaModel['media_kind']; readonly media: MediaModel };

const MODEL_COLUMNS: readonly Column<CatalogModel>[] = [
    { header: 'id', value: (model) => model.id },
    { header: 'kind', value: (model) => model.kind },
    { header: 'title', value: (model) => ('media' in model ? model.media.title : model.text.name) },
    { header: 'price', value: (model) => price(model) },
];

const RUN_COLUMNS: readonly Column<MediaRun>[] = [
    { header: 'id', value: (run) => run.id },
    { header: 'model', value: (run) => run.model },
    { header: 'kind', value: (run) => run.media_kind },
    { header: 'status', value: (run) => run.status },
    { header: 'created', value: (run) => run.created_at },
];

const list: Command = {
    options: {
        for: {
            description: 'Recommend media models for what you want to make.',
            type: 'string',
            valueName: 'INTENT',
        },
        type: {
            description: `Only models of this kind: ${KINDS.join(', ')}.`,
            type: 'string',
            valueName: 'KIND',
        },
    },
    path: ['cloud', 'models', 'list'],
    summary: 'List the models you can run, text and media, with their prices.',
    async run(context, input) {
        const type = stringOption(input, 'type');
        if (type !== undefined && !KINDS.some((kind) => kind === type))
            throw new UsageError(`--type must be one of ${KINDS.join(', ')}.`);
        const intent = stringOption(input, 'for');
        const client = await context.client();
        const models =
            intent === undefined
                ? await catalog(
                      client,
                      type === undefined ? 'both' : type === 'text' ? 'text' : 'media'
                  )
                : (
                      await unwrap(
                          await client.GET('/v1/media/recommendations', {
                              params: { query: { intent } },
                          })
                      )
                  ).data.map(mediaModel);
        context.output.list(
            { data: models.filter((model) => type === undefined || model.kind === type) },
            MODEL_COLUMNS
        );
    },
};

const get: Command = {
    arguments: '<model>',
    path: ['cloud', 'models', 'get'],
    summary: 'Show a model: its kind, price, and what it takes.',
    async run(context, input) {
        const model = await findModel(await context.client(), argument(input, 0, 'model'));
        if (context.output.json)
            return context.output.record('media' in model ? model.media : model.text);
        if (!('media' in model)) {
            const capabilities = model.text.capabilities;
            const longContext = model.text.pricing?.contextOver200kPerM ?? null;
            return context.output.record({
                id: model.id,
                kind: model.kind,
                price: price(model),
                ...(longContext === null
                    ? {}
                    : {
                          long_prompt_price: `$${longContext.inputPerM} in / $${longContext.outputPerM} out per 1M tokens above ${longContext.inputTokensAbove} input tokens`,
                      }),
                context_tokens: capabilities.maxInputTokens,
                input: capabilities.input.join(', '),
                output: capabilities.output.join(', '),
                reasoning: capabilities.reasoning,
                tools: capabilities.supportsToolCall,
            });
        }
        const required = new Set(model.media.input.required);
        context.output.record({
            id: model.id,
            kind: model.kind,
            title: model.media.title,
            description: model.media.description,
            price: price(model),
            input: model.media.input.fields
                .map(
                    (field) => `${field.name}${required.has(field.name) ? '*' : ''} (${field.type})`
                )
                .join(', '),
        });
    },
};

const run: Command = {
    arguments: '<model> [prompt...]',
    options: {
        ...BODY_OPTIONS,
        'no-wait': {
            description: 'Start a media run and print its id instead of waiting for it.',
            type: 'boolean',
        },
        overwrite: {
            description: 'With --save-to, replace a file already there.',
            type: 'boolean',
        },
        'save-to': {
            description:
                "Keep a media run's outputs as project files: a path, or a prefix ending in /.",
            type: 'string',
            valueName: 'PATH',
        },
        system: { description: 'A system prompt, for a text model.', type: 'string' },
        yes: {
            description:
                'Run a media model without confirming its estimated price. Pass it only once your person has agreed.',
            type: 'boolean',
        },
    },
    path: ['cloud', 'models', 'run'],
    summary:
        'Run any model. A text model replies to the prompt (or stdin); a media model is priced, confirmed, then run.',
    async run(context, input) {
        const client = await context.client();
        const model = await findModel(client, argument(input, 0, 'model'));
        const prompt = input.positionals.slice(1).join(' ').trim();
        return 'media' in model
            ? await runMedia(context, input, client, model.id, prompt)
            : await runText(context, input, client, model.id, prompt);
    },
};

const runs: Command = {
    options: PAGE_OPTIONS,
    path: ['cloud', 'models', 'runs', 'list'],
    summary: 'List recent media runs in the Cloud project.',
    async run(context, input) {
        context.output.list(
            await unwrap(
                await (
                    await context.client()
                ).GET('/v1/media/generations', {
                    params: { query: pageQuery(input) },
                })
            ),
            RUN_COLUMNS
        );
    },
};

const runGet: Command = {
    arguments: '<run_id>',
    path: ['cloud', 'models', 'runs', 'get'],
    summary: 'Show a media run, its status and its outputs.',
    async run(context, input) {
        context.output.record(await getRun(await context.client(), argument(input, 0, 'run_id')));
    },
};

async function getRun(client: CloudClient, id: string): Promise<MediaRun> {
    return await unwrap(
        await client.GET('/v1/media/generations/{generation_id}', {
            params: { path: { generation_id: id } },
        })
    );
}

async function runText(
    context: CommandContext,
    input: CommandInput,
    client: CloudClient,
    model: string,
    argumentPrompt: string
): Promise<number | void> {
    if (stringOption(input, 'data') !== undefined || stringOption(input, 'file') !== undefined)
        throw new UsageError(`${model} is a text model: give it a prompt, not --data or --file.`);
    // A prompt piped in, such as a file to summarise, when none is given as arguments.
    const prompt =
        argumentPrompt.length > 0 || context.runtime.prompt !== null
            ? argumentPrompt
            : (await context.runtime.readStdin()).trim();
    if (prompt.length === 0)
        throw new UsageError('Give the prompt as arguments, or pipe it on stdin.');
    const system = stringOption(input, 'system');
    const response = await unwrap(
        await client.POST('/v1/chat/completions', {
            body: {
                model,
                messages: [
                    ...(system === undefined ? [] : [{ role: 'system' as const, content: system }]),
                    { role: 'user' as const, content: prompt },
                ],
            },
        })
    );
    if (context.output.jsonContent) return context.output.record(response);
    // The operation also answers as a stream; without `stream` it is always the JSON reply.
    if (typeof response !== 'object' || response === null || !('choices' in response))
        throw new CommandFailure('failed', `${model} answered without a reply.`, null);
    const content = response.choices[0]?.message.content;
    context.runtime.writeOutput(
        `${typeof content === 'string' ? content : JSON.stringify(content ?? null)}\n`
    );
}

async function runMedia(
    context: CommandContext,
    input: CommandInput,
    client: CloudClient,
    model: string,
    prompt: string
): Promise<number | void> {
    if (stringOption(input, 'system') !== undefined)
        throw new UsageError(`${model} is a media model: --system is for text models.`);
    const body = await readJsonBody(context, input);
    if (body !== null && !isJsonObject(body))
        throw new UsageError("The model's input must be a JSON object.");
    const modelInput = {
        ...(isJsonObject(body) ? body : {}),
        ...(prompt.length === 0 ? {} : { prompt }),
    };
    if (Object.keys(modelInput).length === 0)
        throw new UsageError("Give the model's input as a prompt, --data or --file.");

    const estimate = await unwrap(
        await client.POST('/v1/media/estimates', { body: { input: modelInput, model } })
    );
    context.output.note(
        `Estimated $${estimate.amount_usd} (${estimate.confidence}): ${estimate.explanation}`
    );
    await requireConsent(
        context,
        flag(input, 'yes'),
        `Running ${model} spends about $${estimate.amount_usd} of credits.`
    );
    const saveTo = stringOption(input, 'save-to');
    let generation = await unwrap(
        await client.POST('/v1/media/generations', {
            params: { header: { 'Idempotency-Key': randomUUID() } },
            body: {
                estimate_id: estimate.id,
                ...(saveTo === undefined
                    ? {}
                    : { overwrite: flag(input, 'overwrite'), save_to: saveTo }),
            },
        })
    );
    if (flag(input, 'no-wait'))
        return context.output.result(
            generation,
            `Started run ${generation.id}. Check it with dexto cloud models runs get ${generation.id}.`
        );
    while (!generation.completed) {
        await context.runtime.sleep(2000);
        generation = await getRun(client, generation.id);
    }
    if (generation.error !== null)
        throw new CommandFailure(
            'failed',
            `Run ${generation.id} failed: ${generation.error.message}`,
            null
        );
    if (context.output.json) return context.output.record(generation);
    context.runtime.writeOutput(`Run ${generation.id} ${generation.status}.\n`);
    for (const resource of generation.resources)
        context.runtime.writeOutput(
            `${resource.file_path ?? resource.filename ?? resource.id}${resource.url === null ? '' : `  ${resource.url}`}\n`
        );
}

/** The text catalog, the media catalog, or both (text first), as one list. */
async function catalog(
    client: CloudClient,
    which: 'both' | 'media' | 'text'
): Promise<CatalogModel[]> {
    const [text, media] = await Promise.all([
        which === 'media' ? null : unwrap(await client.GET('/v1/models')),
        which === 'text' ? null : unwrap(await client.GET('/v1/media/models')),
    ]);
    return [
        ...(text?.data ?? []).map((model) => ({
            id: model.id,
            kind: 'text' as const,
            text: model,
        })),
        ...(media?.data ?? []).map(mediaModel),
    ];
}

async function findModel(client: CloudClient, id: string): Promise<CatalogModel> {
    const model = (await catalog(client, 'both')).find((each) => each.id === id);
    if (model === undefined)
        throw new UsageError(`Unknown model ${id}. List them with dexto cloud models list.`);
    return model;
}

function mediaModel(model: MediaModel): CatalogModel {
    return { id: model.id, kind: model.media_kind, media: model };
}

function price(model: CatalogModel): string {
    if (!('media' in model)) {
        const pricing = model.text.pricing;
        if (pricing === null) return '-';
        const base = `$${pricing.inputPerM} in / $${pricing.outputPerM} out per 1M tokens`;
        return pricing.contextOver200kPerM === null ? base : `${base}, more for long prompts`;
    }
    const pricing = model.media.pricing;
    return pricing.unit_price_usd === undefined
        ? pricing.estimate_mode
        : `$${pricing.unit_price_usd}/${pricing.unit}`;
}

export const modelCommands: readonly Command[] = [list, get, run, runs, runGet];
