import { propagation } from '@opentelemetry/api';
import type { BaggageEntry, Context } from '@opentelemetry/api';
import { z } from 'zod';

const HOST_RUNTIME_ENTRY_PREFIX = 'hostRuntime.ids.';
const WELL_KNOWN_HOST_RUNTIME_ID_KEYS = ['runtimeId', 'runId', 'attemptId', 'workspaceId'] as const;
const WELL_KNOWN_HOST_RUNTIME_ID_KEY_SET = new Set<string>(WELL_KNOWN_HOST_RUNTIME_ID_KEYS);

const HostRuntimeIdKeySchema = z
    .string()
    .min(1)
    .regex(
        /^[A-Za-z0-9._-]+$/,
        'Runtime ID keys may only contain letters, numbers, dot, underscore, or hyphen.'
    );

const HostRuntimeIdValueSchema = z.string().trim().min(1);

export const HostRuntimeIdsSchema = z
    .record(HostRuntimeIdKeySchema, HostRuntimeIdValueSchema)
    .describe(
        'Host-owned runtime IDs keyed by a stable identifier name such as runId, attemptId, or workspaceId.'
    );

export const HostRuntimeContextSchema = z
    .object({
        ids: HostRuntimeIdsSchema.optional().describe(
            'Optional host-owned runtime IDs used for correlation across orchestration, telemetry, logs, and events.'
        ),
    })
    .strict()
    .describe('Host-owned runtime context surfaced through core runtime flows.');

export type HostRuntimeIds = z.output<typeof HostRuntimeIdsSchema>;
export type HostRuntimeContext = z.output<typeof HostRuntimeContextSchema>;

function freezeHostRuntimeContext(hostRuntime: HostRuntimeContext): HostRuntimeContext {
    return Object.freeze({
        ids: Object.freeze({ ...hostRuntime.ids }),
    });
}

export function normalizeHostRuntimeContext(
    input: z.input<typeof HostRuntimeContextSchema> | undefined
): HostRuntimeContext | undefined {
    if (input === undefined) {
        return undefined;
    }

    const parsed = HostRuntimeContextSchema.parse(input);
    if (!parsed.ids || Object.keys(parsed.ids).length === 0) {
        return undefined;
    }

    return freezeHostRuntimeContext({ ids: parsed.ids });
}

export function resolveHostRuntimeContext({
    inherited,
    explicit,
    runId,
}: {
    inherited?: HostRuntimeContext | undefined;
    explicit?: HostRuntimeContext | undefined;
    runId?: string | undefined;
}): HostRuntimeContext | undefined {
    const ids = {
        ...(inherited?.ids ?? {}),
        ...(explicit?.ids ?? {}),
        ...(runId !== undefined ? { runId } : {}),
    };

    if (Object.keys(ids).length === 0) {
        return undefined;
    }

    return normalizeHostRuntimeContext({ ids });
}

function isWellKnownHostRuntimeIdKey(
    key: string
): key is (typeof WELL_KNOWN_HOST_RUNTIME_ID_KEYS)[number] {
    return WELL_KNOWN_HOST_RUNTIME_ID_KEY_SET.has(key);
}

export function isHostRuntimeBaggageKey(key: string): boolean {
    return key.startsWith(HOST_RUNTIME_ENTRY_PREFIX) || WELL_KNOWN_HOST_RUNTIME_ID_KEY_SET.has(key);
}

function getValidHostRuntimeIdValue(value: string): string | undefined {
    const parsed = HostRuntimeIdValueSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

export function getHostRuntimeBaggageEntries(
    hostRuntime?: HostRuntimeContext
): Record<string, BaggageEntry> {
    const ids = hostRuntime?.ids;
    if (!ids) {
        return {};
    }

    const entries: Record<string, BaggageEntry> = {};
    for (const [key, value] of Object.entries(ids)) {
        entries[`${HOST_RUNTIME_ENTRY_PREFIX}${key}`] = { value };
        if (isWellKnownHostRuntimeIdKey(key)) {
            entries[key] = { value };
        }
    }

    return entries;
}

export function getHostRuntimeAttributes(hostRuntime?: HostRuntimeContext): Record<string, string> {
    const ids = hostRuntime?.ids;
    if (!ids) {
        return {};
    }

    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(ids)) {
        attributes[`${HOST_RUNTIME_ENTRY_PREFIX}${key}`] = value;
        if (isWellKnownHostRuntimeIdKey(key)) {
            attributes[key] = value;
        }
    }

    return attributes;
}

export function getHostRuntimeContextFromBaggage(ctx: Context): HostRuntimeContext | undefined {
    const baggage = propagation.getBaggage(ctx);
    if (!baggage) {
        return undefined;
    }

    const ids: Record<string, string> = {};

    for (const [key, entry] of baggage.getAllEntries()) {
        if (key.startsWith(HOST_RUNTIME_ENTRY_PREFIX)) {
            const hostRuntimeKey = key.slice(HOST_RUNTIME_ENTRY_PREFIX.length);
            if (!HostRuntimeIdKeySchema.safeParse(hostRuntimeKey).success) {
                continue;
            }

            const value = getValidHostRuntimeIdValue(entry.value);
            if (value === undefined) {
                continue;
            }

            ids[hostRuntimeKey] = value;
        }
    }

    for (const key of WELL_KNOWN_HOST_RUNTIME_ID_KEYS) {
        if (ids[key] !== undefined) {
            continue;
        }
        const entry = baggage.getEntry(key);
        if (entry) {
            const value = getValidHostRuntimeIdValue(entry.value);
            if (value !== undefined) {
                ids[key] = value;
            }
        }
    }

    if (Object.keys(ids).length === 0) {
        return undefined;
    }

    return normalizeHostRuntimeContext({ ids });
}
