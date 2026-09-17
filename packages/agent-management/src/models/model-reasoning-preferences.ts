/**
 * Per-model reasoning preferences (CLI state).
 *
 * Remembers the last explicit reasoning choice (variant and/or budget tokens) per
 * canonical model identity so switching A -> B -> A restores A's settings, across restarts.
 *
 * - Key: provider + model (+ baseURL when set), shared with the model picker state so the
 *   same model on two providers/endpoints never collides.
 * - Value: an explicit override, or `null` when the user explicitly reset to provider defaults.
 *   A missing entry means "never chosen".
 * - Saved values are validated against the model's current reasoning profile before use;
 *   settings the model no longer supports are reported, never applied.
 * - Contains no credentials or transcripts.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import {
    LLM_PROVIDERS,
    supportsReasoningVariant,
    type LLMProvider,
    type ReasoningProfile,
} from '@dexto/llm';
import { getModelReasoningPreferencesPath } from './path-resolver.js';
import { toModelPickerKey } from './model-picker-state.js';

export const MODEL_REASONING_PREFERENCES_VERSION = 1;

const ModelReasoningIdentitySchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS),
        model: z.string().trim().min(1),
        baseURL: z.string().trim().min(1).optional(),
    })
    .strict();

const ModelReasoningOverrideSchema = z
    .object({
        variant: z.string().trim().min(1).optional(),
        budgetTokens: z.number().int().positive().optional(),
    })
    .strict()
    .refine((value) => value.variant !== undefined || value.budgetTokens !== undefined, {
        message: 'A reasoning override must set variant and/or budgetTokens',
    });

const ModelReasoningPreferenceEntrySchema = ModelReasoningIdentitySchema.extend({
    /** Explicit override, or `null` when the user explicitly reset this model to provider defaults. */
    reasoning: ModelReasoningOverrideSchema.nullable(),
    updatedAt: z.string().datetime(),
}).strict();

const ModelReasoningPreferencesStateSchema = z
    .object({
        version: z.literal(MODEL_REASONING_PREFERENCES_VERSION),
        models: z.record(z.string(), ModelReasoningPreferenceEntrySchema).default({}),
    })
    .strict();

export type ModelReasoningIdentity = z.output<typeof ModelReasoningIdentitySchema>;
export type ModelReasoningOverride = z.output<typeof ModelReasoningOverrideSchema>;
export type ModelReasoningPreferenceEntry = z.output<typeof ModelReasoningPreferenceEntrySchema>;
export type ModelReasoningPreferencesState = z.output<typeof ModelReasoningPreferencesStateSchema>;

export interface ModelReasoningPreferencesLoadResult {
    state: ModelReasoningPreferencesState;
    /** Human-readable reasons for anything that was ignored while loading. */
    warnings: string[];
}

function createDefaultState(): ModelReasoningPreferencesState {
    return { version: MODEL_REASONING_PREFERENCES_VERSION, models: {} };
}

/**
 * Canonical identity key: `provider|model` plus `|baseURL` when an endpoint is set.
 * Shared with the model picker so recents/favorites/preferences agree on identity.
 */
export function toModelReasoningPreferenceKey(model: {
    provider: LLMProvider;
    model: string;
    baseURL?: string | undefined;
}): string {
    return toModelPickerKey(model);
}

function describeIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
}

/**
 * Parse raw file content into a state, dropping anything invalid with a warning.
 * Pure; exported for tests and for hosts that keep their own copy of the file.
 */
export function parseModelReasoningPreferences(raw: unknown): ModelReasoningPreferencesLoadResult {
    const warnings: string[] = [];

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        warnings.push('Reasoning preferences file is not a JSON object; ignoring it.');
        return { state: createDefaultState(), warnings };
    }

    const version = Reflect.get(raw, 'version');
    if (typeof version !== 'number' || !Number.isInteger(version)) {
        warnings.push('Reasoning preferences file has no integer version; ignoring it.');
        return { state: createDefaultState(), warnings };
    }

    if (version > MODEL_REASONING_PREFERENCES_VERSION) {
        warnings.push(
            `Reasoning preferences were written by a newer Dexto (version ${version}, ` +
                `this build reads version ${MODEL_REASONING_PREFERENCES_VERSION}); ignoring them.`
        );
        return { state: createDefaultState(), warnings };
    }

    if (version < MODEL_REASONING_PREFERENCES_VERSION) {
        // Version 1 is the first published shape; older numbers were never written by Dexto.
        warnings.push(
            `Reasoning preferences version ${version} is not supported (expected ` +
                `${MODEL_REASONING_PREFERENCES_VERSION}); ignoring them.`
        );
        return { state: createDefaultState(), warnings };
    }

    const rawModels = Reflect.get(raw, 'models');
    const models: Record<string, ModelReasoningPreferenceEntry> = {};
    if (rawModels !== undefined) {
        if (typeof rawModels !== 'object' || rawModels === null || Array.isArray(rawModels)) {
            warnings.push('Reasoning preferences "models" is not an object; ignoring it.');
        } else {
            for (const [key, rawEntry] of Object.entries(rawModels)) {
                const parsed = ModelReasoningPreferenceEntrySchema.safeParse(rawEntry);
                if (!parsed.success) {
                    warnings.push(
                        `Ignoring invalid reasoning preference "${key}": ${describeIssues(parsed.error)}`
                    );
                    continue;
                }
                const expectedKey = toModelReasoningPreferenceKey(parsed.data);
                if (expectedKey !== key) {
                    warnings.push(
                        `Ignoring reasoning preference "${key}": identity resolves to "${expectedKey}".`
                    );
                    continue;
                }
                models[key] = parsed.data;
            }
        }
    }

    const state = ModelReasoningPreferencesStateSchema.safeParse({
        version: MODEL_REASONING_PREFERENCES_VERSION,
        models,
    });
    if (!state.success) {
        warnings.push(`Reasoning preferences failed validation: ${describeIssues(state.error)}`);
        return { state: createDefaultState(), warnings };
    }

    return { state: state.data, warnings };
}

export async function loadModelReasoningPreferences(): Promise<ModelReasoningPreferencesLoadResult> {
    const filePath = getModelReasoningPreferencesPath();

    let content: string;
    try {
        content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { state: createDefaultState(), warnings: [] };
        }
        return {
            state: createDefaultState(),
            warnings: [
                `Could not read reasoning preferences at ${filePath}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            ],
        };
    }

    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch (error) {
        return {
            state: createDefaultState(),
            warnings: [
                `Reasoning preferences at ${filePath} are not valid JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            ],
        };
    }

    return parseModelReasoningPreferences(raw);
}

async function writeStateAtomic(state: ModelReasoningPreferencesState): Promise<void> {
    const filePath = getModelReasoningPreferencesPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

    try {
        await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
        await fs.rename(tempPath, filePath);
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

// Serialises read-modify-write cycles within this process. Writes from other processes
// are last-writer-wins on the atomic rename.
let writeQueue: Promise<unknown> = Promise.resolve();

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(operation, operation);
    writeQueue = run.catch(() => undefined);
    return run;
}

export async function getModelReasoningPreference(
    model: ModelReasoningIdentity
): Promise<{ entry: ModelReasoningPreferenceEntry | null; warnings: string[] }> {
    const identity = ModelReasoningIdentitySchema.parse(model);
    const { state, warnings } = await loadModelReasoningPreferences();
    return { entry: state.models[toModelReasoningPreferenceKey(identity)] ?? null, warnings };
}

/**
 * Persist the user's explicit reasoning choice for a model.
 * Pass `reasoning: null` to record an explicit reset to provider defaults.
 */
export async function rememberModelReasoningPreference(input: {
    model: ModelReasoningIdentity;
    reasoning: ModelReasoningOverride | null;
}): Promise<ModelReasoningPreferenceEntry> {
    const identity = ModelReasoningIdentitySchema.parse(input.model);
    const reasoning =
        input.reasoning === null ? null : ModelReasoningOverrideSchema.parse(input.reasoning);

    return withWriteLock(async () => {
        const { state } = await loadModelReasoningPreferences();
        const entry: ModelReasoningPreferenceEntry = {
            provider: identity.provider,
            model: identity.model,
            ...(identity.baseURL ? { baseURL: identity.baseURL } : {}),
            reasoning,
            updatedAt: new Date().toISOString(),
        };
        const nextState: ModelReasoningPreferencesState = {
            version: MODEL_REASONING_PREFERENCES_VERSION,
            models: { ...state.models, [toModelReasoningPreferenceKey(identity)]: entry },
        };
        await writeStateAtomic(nextState);
        return entry;
    });
}

/** Remove a saved preference (back to "never chosen"). Returns whether an entry existed. */
export async function forgetModelReasoningPreference(
    model: ModelReasoningIdentity
): Promise<boolean> {
    const identity = ModelReasoningIdentitySchema.parse(model);
    const key = toModelReasoningPreferenceKey(identity);

    return withWriteLock(async () => {
        const { state } = await loadModelReasoningPreferences();
        if (!(key in state.models)) {
            return false;
        }
        const { [key]: _removed, ...models } = state.models;
        await writeStateAtomic({ version: MODEL_REASONING_PREFERENCES_VERSION, models });
        return true;
    });
}

export interface StaleModelReasoningSetting {
    field: 'variant' | 'budgetTokens';
    value: string | number;
    reason: string;
}

export interface ResolvedModelReasoningPreference {
    /**
     * What may be applied to the model right now:
     * - `undefined`: nothing saved (or nothing saved is still supported)
     * - `null`: the user explicitly reset this model to provider defaults
     * - object: the saved override, restricted to fields the model still supports
     */
    reasoning: ModelReasoningOverride | null | undefined;
    /** Saved settings the current profile no longer supports. Report them; never apply them. */
    stale: StaleModelReasoningSetting[];
}

/**
 * Validate a saved entry against the model's current reasoning profile.
 */
export function resolveModelReasoningPreference(input: {
    entry: ModelReasoningPreferenceEntry | null;
    profile: ReasoningProfile;
}): ResolvedModelReasoningPreference {
    const { entry, profile } = input;
    if (entry === null) {
        return { reasoning: undefined, stale: [] };
    }
    if (entry.reasoning === null) {
        return { reasoning: null, stale: [] };
    }

    const stale: StaleModelReasoningSetting[] = [];
    const usable: ModelReasoningOverride = {};

    if (entry.reasoning.variant !== undefined) {
        if (!profile.capable) {
            stale.push({
                field: 'variant',
                value: entry.reasoning.variant,
                reason: 'this model no longer exposes reasoning variants',
            });
        } else if (!supportsReasoningVariant(profile, entry.reasoning.variant)) {
            stale.push({
                field: 'variant',
                value: entry.reasoning.variant,
                reason: `supported variants are now: ${profile.supportedVariants.join(', ')}`,
            });
        } else {
            usable.variant = entry.reasoning.variant;
        }
    }

    if (entry.reasoning.budgetTokens !== undefined) {
        if (!profile.capable || !profile.supportsBudgetTokens) {
            stale.push({
                field: 'budgetTokens',
                value: entry.reasoning.budgetTokens,
                reason: 'this model does not accept a reasoning budget',
            });
        } else {
            usable.budgetTokens = entry.reasoning.budgetTokens;
        }
    }

    const hasUsable = usable.variant !== undefined || usable.budgetTokens !== undefined;
    return { reasoning: hasUsable ? usable : undefined, stale };
}
