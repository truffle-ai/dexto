import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { LLM_PROVIDERS, type LLMProvider } from '@dexto/core';
import { getModelPickerStatePath } from './path-resolver.js';

export const MODEL_PICKER_STATE_VERSION = 1;
export const MODEL_PICKER_RECENTS_LIMIT = 10;
export const MODEL_PICKER_FAVORITES_LIMIT = 100;

const ModelPickerModelSchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS),
        model: z.string().trim().min(1),
    })
    .strict();

const ModelPickerEntrySchema = ModelPickerModelSchema.extend({
    updatedAt: z.string().datetime(),
}).strict();

const ModelPickerStateSchema = z
    .object({
        version: z.literal(MODEL_PICKER_STATE_VERSION),
        recents: z.array(ModelPickerEntrySchema).default([]),
        favorites: z.array(ModelPickerEntrySchema).default([]),
    })
    .strict();

const SetFavoriteModelsInputSchema = z
    .object({
        favorites: z.array(ModelPickerModelSchema),
    })
    .strict();

export type ModelPickerModel = z.output<typeof ModelPickerModelSchema>;
export type ModelPickerEntry = z.output<typeof ModelPickerEntrySchema>;
export type ModelPickerState = z.output<typeof ModelPickerStateSchema>;
export type SetFavoriteModelsInput = z.output<typeof SetFavoriteModelsInputSchema>;

function createDefaultState(): ModelPickerState {
    return {
        version: MODEL_PICKER_STATE_VERSION,
        recents: [],
        favorites: [],
    };
}

function normalizeEntries(input: {
    entries: ModelPickerEntry[];
    limit: number;
}): ModelPickerEntry[] {
    const normalized: ModelPickerEntry[] = [];
    const seen = new Set<string>();

    for (const entry of input.entries) {
        const parsed = ModelPickerEntrySchema.safeParse(entry);
        if (!parsed.success) {
            continue;
        }

        const key = toModelPickerKey(parsed.data);
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push(parsed.data);

        if (normalized.length >= input.limit) {
            break;
        }
    }

    return normalized;
}

function normalizeState(input: { state: ModelPickerState }): ModelPickerState {
    return {
        version: MODEL_PICKER_STATE_VERSION,
        recents: normalizeEntries({
            entries: input.state.recents,
            limit: MODEL_PICKER_RECENTS_LIMIT,
        }),
        favorites: normalizeEntries({
            entries: input.state.favorites,
            limit: MODEL_PICKER_FAVORITES_LIMIT,
        }),
    };
}

function createEntry(input: { model: ModelPickerModel; updatedAt: string }): ModelPickerEntry {
    return {
        provider: input.model.provider,
        model: input.model.model,
        updatedAt: input.updatedAt,
    };
}

export function toModelPickerKey(input: { provider: LLMProvider; model: string }): string {
    return `${input.provider}|${input.model}`;
}

export function pruneModelPickerState(input: {
    state: ModelPickerState;
    allowedKeys: Set<string>;
}): ModelPickerState {
    const recents = input.state.recents.filter((entry) =>
        input.allowedKeys.has(toModelPickerKey(entry))
    );
    const favorites = input.state.favorites.filter((entry) =>
        input.allowedKeys.has(toModelPickerKey(entry))
    );

    return normalizeState({
        state: {
            version: MODEL_PICKER_STATE_VERSION,
            recents,
            favorites,
        },
    });
}

export async function loadModelPickerState(): Promise<ModelPickerState> {
    const filePath = getModelPickerStatePath();

    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = ModelPickerStateSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            return createDefaultState();
        }

        return normalizeState({ state: parsed.data });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return createDefaultState();
        }

        return createDefaultState();
    }
}

export async function saveModelPickerState(state: ModelPickerState): Promise<void> {
    const parsed = ModelPickerStateSchema.safeParse(state);
    if (!parsed.success) {
        throw new Error(
            `Invalid model picker state: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
        );
    }

    const filePath = getModelPickerStatePath();
    const normalized = normalizeState({ state: parsed.data });

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
}

export async function recordRecentModel(model: ModelPickerModel): Promise<ModelPickerState> {
    const parsedModel = ModelPickerModelSchema.parse(model);
    const now = new Date().toISOString();
    const state = await loadModelPickerState();

    const recents = normalizeEntries({
        entries: [createEntry({ model: parsedModel, updatedAt: now }), ...state.recents],
        limit: MODEL_PICKER_RECENTS_LIMIT,
    });

    const nextState: ModelPickerState = {
        version: MODEL_PICKER_STATE_VERSION,
        recents,
        favorites: state.favorites,
    };

    await saveModelPickerState(nextState);
    return nextState;
}

export async function toggleFavoriteModel(
    model: ModelPickerModel
): Promise<{ state: ModelPickerState; isFavorite: boolean }> {
    const parsedModel = ModelPickerModelSchema.parse(model);
    const state = await loadModelPickerState();
    const key = toModelPickerKey(parsedModel);
    const exists = state.favorites.some((entry) => toModelPickerKey(entry) === key);

    const favorites = exists
        ? state.favorites.filter((entry) => toModelPickerKey(entry) !== key)
        : normalizeEntries({
              entries: [
                  createEntry({
                      model: parsedModel,
                      updatedAt: new Date().toISOString(),
                  }),
                  ...state.favorites,
              ],
              limit: MODEL_PICKER_FAVORITES_LIMIT,
          });

    const nextState: ModelPickerState = {
        version: MODEL_PICKER_STATE_VERSION,
        recents: state.recents,
        favorites,
    };

    await saveModelPickerState(nextState);

    return {
        state: nextState,
        isFavorite: !exists,
    };
}

export async function setFavoriteModels(input: SetFavoriteModelsInput): Promise<ModelPickerState> {
    const parsed = SetFavoriteModelsInputSchema.parse(input);
    const state = await loadModelPickerState();
    const now = new Date().toISOString();

    const favorites = normalizeEntries({
        entries: parsed.favorites.map((favorite) =>
            createEntry({ model: favorite, updatedAt: now })
        ),
        limit: MODEL_PICKER_FAVORITES_LIMIT,
    });

    const nextState: ModelPickerState = {
        version: MODEL_PICKER_STATE_VERSION,
        recents: state.recents,
        favorites,
    };

    await saveModelPickerState(nextState);
    return nextState;
}
