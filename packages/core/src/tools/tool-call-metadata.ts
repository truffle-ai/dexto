import type { JSONSchema7 } from 'json-schema';

export type ToolCallMetadata = {
    runInBackground?: boolean;
    timeoutMs?: number;
    notifyOnComplete?: boolean;
    callDescription?: string;
};

export type ToolCallMetaWrapper = {
    __dexto: ToolCallMetadata;
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
    additionalProperties: false,
};

const META_KEY = '__dexto';

export function wrapToolParametersSchema(parameters: JSONSchema7): JSONSchema7 {
    if (parameters.type !== 'object' || !parameters.properties) {
        return parameters;
    }

    if (META_KEY in parameters.properties) {
        return parameters;
    }

    return {
        ...parameters,
        properties: {
            ...parameters.properties,
            [META_KEY]: META_SCHEMA,
        },
    };
}

export function extractToolCallMeta(args: Record<string, unknown>): {
    toolArgs: Record<string, unknown>;
    meta: ToolCallMetadata;
} {
    const { __dexto, ...toolArgs } = args as ToolCallMetaWrapper & Record<string, unknown>;
    const meta = __dexto ?? {};

    return {
        toolArgs,
        meta,
    };
}
