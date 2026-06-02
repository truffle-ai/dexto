import type { JSONSchema7 } from 'json-schema';

export type ToolCallMetadata = Record<string, unknown> & {
    runInBackground?: boolean;
    timeoutMs?: number;
    notifyOnComplete?: boolean;
    callDescription?: string;
};

export type ToolCallMetaWrapper = {
    __meta: ToolCallMetadata;
};

const META_SCHEMA: JSONSchema7 = {
    type: 'object',
    properties: {
        runInBackground: {
            type: 'boolean',
            description: 'Run the tool in background and return a task ID immediately.',
        },
        timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds for background tasks.',
        },
        notifyOnComplete: {
            type: 'boolean',
            description: 'Notify when the background task completes.',
        },
        callDescription: {
            type: 'string',
            description: 'Optional description shown to the user when requesting approval.',
        },
    },
    additionalProperties: true,
};

const META_KEY = '__meta';

function hasObjectAlternative(parameters: JSONSchema7): boolean {
    const alternatives = parameters.oneOf ?? parameters.anyOf;
    return (
        Array.isArray(alternatives) &&
        alternatives.some(
            (alternative) =>
                alternative !== true && alternative !== false && alternative.type === 'object'
        )
    );
}

function normalizeToolParametersSchema(parameters: JSONSchema7): JSONSchema7 {
    if (parameters.type === 'object') {
        return parameters;
    }

    if (hasObjectAlternative(parameters)) {
        return {
            ...parameters,
            type: 'object',
        };
    }

    return {
        type: 'object',
        additionalProperties: true,
    };
}

export function wrapToolParametersSchema(parameters: JSONSchema7): JSONSchema7 {
    const normalized = normalizeToolParametersSchema(parameters);

    if (!normalized.properties) {
        return normalized;
    }

    if (META_KEY in normalized.properties) {
        return normalized;
    }

    return {
        ...normalized,
        properties: {
            ...normalized.properties,
            [META_KEY]: META_SCHEMA,
        },
    };
}

export function extractToolCallMeta(args: Record<string, unknown>): {
    toolArgs: Record<string, unknown>;
    meta: ToolCallMetadata;
} {
    const { __meta, ...toolArgs } = args as ToolCallMetaWrapper & Record<string, unknown>;
    const meta = __meta ?? {};

    return {
        toolArgs,
        meta,
    };
}
