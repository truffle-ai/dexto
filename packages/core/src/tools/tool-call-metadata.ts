import type { JSONSchema7 } from 'json-schema';
import type { JSONSchema7Definition } from 'json-schema';
import type { JSONSchema7Type } from 'json-schema';

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
const FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS = ['oneOf', 'anyOf', 'allOf', 'enum', 'not'] as const;

function hasForbiddenTopLevelSchemaKey(parameters: JSONSchema7): boolean {
    return FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS.some((key) => key in parameters);
}

function readObjectAlternatives(parameters: JSONSchema7): JSONSchema7[] {
    const alternatives = parameters.oneOf ?? parameters.anyOf;
    if (!Array.isArray(alternatives)) {
        return [];
    }

    return alternatives.filter(
        (alternative): alternative is JSONSchema7 =>
            alternative !== true && alternative !== false && alternative.type === 'object'
    );
}

function readRequiredPropertyNames(schema: JSONSchema7): Set<string> {
    return new Set(
        Array.isArray(schema.required)
            ? schema.required.filter((propertyName) => typeof propertyName === 'string')
            : []
    );
}

function intersectRequiredProperties(alternatives: JSONSchema7[]): string[] | undefined {
    if (alternatives.length === 0) {
        return undefined;
    }

    const requiredSets = alternatives.map(readRequiredPropertyNames);
    const first = requiredSets[0];
    if (first === undefined) {
        return undefined;
    }
    const rest = requiredSets.slice(1);
    const required = [...first].filter((propertyName) =>
        rest.every((requiredProperties) => requiredProperties.has(propertyName))
    );

    return required.length === 0 ? undefined : required;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function mergeEnumValues(values: JSONSchema7Type[]): JSONSchema7Type[] {
    const merged: JSONSchema7Type[] = [];

    for (const value of values) {
        if (!merged.some((existing) => valuesEqual(existing, value))) {
            merged.push(value);
        }
    }

    return merged;
}

function readEnumValues(schema: JSONSchema7): JSONSchema7Type[] | undefined {
    if (schema.const !== undefined) {
        return [schema.const];
    }

    return Array.isArray(schema.enum) ? schema.enum : undefined;
}

function mergePropertySchema(
    current: JSONSchema7Definition | undefined,
    next: JSONSchema7Definition
): JSONSchema7Definition {
    if (current === undefined || current === false) {
        return next;
    }

    if (current === true || next === true) {
        return {};
    }

    if (next === false) {
        return current;
    }

    if (valuesEqual(current, next)) {
        return current;
    }

    const currentEnumValues = readEnumValues(current);
    const nextEnumValues = readEnumValues(next);
    if (currentEnumValues !== undefined && nextEnumValues !== undefined) {
        return { enum: mergeEnumValues([...currentEnumValues, ...nextEnumValues]) };
    }

    if (current.type !== undefined && valuesEqual(current.type, next.type)) {
        return { type: current.type };
    }

    return {};
}

function flattenObjectUnionSchema(parameters: JSONSchema7): JSONSchema7 | undefined {
    const alternatives = readObjectAlternatives(parameters);
    if (alternatives.length === 0) {
        return undefined;
    }

    const properties: NonNullable<JSONSchema7['properties']> = {};
    const required = intersectRequiredProperties(alternatives);
    for (const alternative of alternatives) {
        const alternativeProperties = alternative.properties ?? {};
        for (const [propertyName, propertySchema] of Object.entries(alternativeProperties)) {
            properties[propertyName] = mergePropertySchema(
                properties[propertyName],
                propertySchema
            );
        }
    }

    return {
        ...(parameters.description === undefined ? {} : { description: parameters.description }),
        type: 'object',
        properties,
        ...(required === undefined ? {} : { required }),
        additionalProperties: true,
    };
}

function normalizeToolParametersSchema(parameters: JSONSchema7): JSONSchema7 {
    if (parameters.type === 'object' && !hasForbiddenTopLevelSchemaKey(parameters)) {
        return parameters;
    }

    const flattened = flattenObjectUnionSchema(parameters);
    if (flattened !== undefined) {
        return flattened;
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
