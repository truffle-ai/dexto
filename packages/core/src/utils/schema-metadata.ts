/**
 * Schema metadata extraction utilities for Zod schemas
 *
 * This module provides utilities to extract metadata from Zod schemas at runtime.
 *
 * IMPORTANT: This uses Zod's private `._def` API which is not officially supported
 * and may break in future Zod versions. We use this approach because:
 * 1. No public Zod API exists for runtime schema introspection
 * 2. Benefits of schema-driven UI metadata outweigh version risk
 * 3. Changes would be caught by TypeScript/tests during upgrades
 *
 * TODO: Update web UI to use these helpers to reduce total code volume and improve maintainability. Also fix these helpers if needed.
 * See packages/webui/components/AgentEditor/CustomizePanel.tsx for the UI side TODO tracking this same goal.
 *
 * If Zod provides official introspection APIs in the future, migrate to those.
 */

import { z } from 'zod';

/**
 * Metadata extracted from a Zod schema
 */
export interface SchemaMetadata {
    /** Default values for each field */
    defaults: Record<string, unknown>;
    /** Required fields (not optional, not with defaults) */
    requiredFields: string[];
    /** Field type information */
    fieldTypes: Record<string, string>;
    /** Field descriptions from .describe() calls */
    descriptions: Record<string, string>;
    /** Enum values for enum fields (e.g., provider: ['openai', 'anthropic']) */
    enumValues: Record<string, string[]>;
}

/**
 * Extract metadata from a discriminated union schema
 * Handles schemas like McpServerConfigSchema (stdio | sse | http)
 */
export interface DiscriminatedUnionMetadata {
    /** The discriminator field name (e.g., "type") */
    discriminator: string;
    /** Possible discriminator values (e.g., ["stdio", "sse", "http"]) */
    options: string[];
    /** Metadata for each option */
    schemas: Record<string, SchemaMetadata>;
}

/**
 * Extract default value from a Zod schema
 * Returns undefined if no default is set
 */
function extractDefault(def: any): unknown {
    // Check for .default()
    if (def.defaultValue !== undefined) {
        return typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
    }

    // Check for branded types (wraps the actual schema)
    if (def.typeName === 'ZodBranded' && def.type) {
        return extractDefault(def.type._def);
    }

    // Check for optional types (unwrap to inner type)
    if (def.typeName === 'ZodOptional' && def.innerType) {
        return extractDefault(def.innerType._def);
    }

    // Check for nullable types
    if (def.typeName === 'ZodNullable' && def.innerType) {
        return extractDefault(def.innerType._def);
    }

    return undefined;
}

/**
 * Extract enum values from a Zod schema
 * Returns undefined if not an enum
 */
function extractEnumValues(def: any): string[] | undefined {
    // Handle branded types
    if (def.typeName === 'ZodBranded' && def.type) {
        return extractEnumValues(def.type._def);
    }

    // Handle optional types
    if (def.typeName === 'ZodOptional' && def.innerType) {
        return extractEnumValues(def.innerType._def);
    }

    // Handle nullable types
    if (def.typeName === 'ZodNullable' && def.innerType) {
        return extractEnumValues(def.innerType._def);
    }

    // Handle effects (transforms, refinements, etc.)
    if (def.typeName === 'ZodEffects' && def.schema) {
        return extractEnumValues(def.schema._def);
    }

    // Extract from ZodEnum
    if (def.typeName === 'ZodEnum') {
        return def.values as string[];
    }

    // Extract from ZodLiteral (single value enum)
    if (def.typeName === 'ZodLiteral') {
        return [String(def.value)];
    }

    return undefined;
}

/**
 * Extract field type name from Zod schema
 */
function extractTypeName(def: any): string {
    // Handle branded types
    if (def.typeName === 'ZodBranded' && def.type) {
        return extractTypeName(def.type._def);
    }

    // Handle optional types
    if (def.typeName === 'ZodOptional' && def.innerType) {
        return extractTypeName(def.innerType._def) + '?';
    }

    // Handle nullable types
    if (def.typeName === 'ZodNullable' && def.innerType) {
        return extractTypeName(def.innerType._def) + '?';
    }

    // Handle literal types
    if (def.typeName === 'ZodLiteral') {
        return `literal(${JSON.stringify(def.value)})`;
    }

    // Handle enum types
    if (def.typeName === 'ZodEnum') {
        return `enum(${def.values.join('|')})`;
    }

    // Handle array types
    if (def.typeName === 'ZodArray') {
        return `array<${extractTypeName(def.type._def)}>`;
    }

    // Handle record types
    if (def.typeName === 'ZodRecord') {
        return `record<${extractTypeName(def.valueType._def)}>`;
    }

    // Handle effects (transforms, refinements, etc.)
    if (def.typeName === 'ZodEffects' && def.schema) {
        return extractTypeName(def.schema._def);
    }

    // Map Zod type names to simplified names
    const typeMap: Record<string, string> = {
        ZodString: 'string',
        ZodNumber: 'number',
        ZodBoolean: 'boolean',
        ZodObject: 'object',
        ZodArray: 'array',
        ZodRecord: 'record',
        ZodUnion: 'union',
        ZodDiscriminatedUnion: 'discriminatedUnion',
    };

    return typeMap[def.typeName] || def.typeName?.replace('Zod', '').toLowerCase() || 'unknown';
}

/**
 * Check if a field is required (not optional, no default)
 */
function isFieldRequired(def: any): boolean {
    // Has a default? Not required for user input
    if (def.defaultValue !== undefined) {
        return false;
    }

    // Is optional? Not required
    if (def.typeName === 'ZodOptional') {
        return false;
    }

    // Is nullable? Not required
    if (def.typeName === 'ZodNullable') {
        return false;
    }

    // Handle branded types
    if (def.typeName === 'ZodBranded' && def.type) {
        return isFieldRequired(def.type._def);
    }

    return true;
}

/**
 * Extract metadata from a Zod object schema
 *
 * @param schema - Zod schema to extract metadata from
 * @returns SchemaMetadata object with defaults, required fields, types, and descriptions
 */
export function extractSchemaMetadata(schema: z.ZodTypeAny): SchemaMetadata {
    const metadata: SchemaMetadata = {
        defaults: {},
        requiredFields: [],
        fieldTypes: {},
        descriptions: {},
        enumValues: {},
    };

    let def = (schema as any)._def;

    // Unwrap branded types
    if (def.typeName === 'ZodBranded' && def.type) {
        def = def.type._def;
    }

    // Handle object schemas
    if (def.typeName !== 'ZodObject') {
        throw new Error(`Expected ZodObject, got ${def.typeName}`);
    }

    const shape = def.shape();

    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
        const fieldDef = (fieldSchema as any)._def;

        // Extract default value
        const defaultValue = extractDefault(fieldDef);
        if (defaultValue !== undefined) {
            metadata.defaults[fieldName] = defaultValue;
        }

        // Check if required
        if (isFieldRequired(fieldDef)) {
            metadata.requiredFields.push(fieldName);
        }

        // Extract type
        metadata.fieldTypes[fieldName] = extractTypeName(fieldDef);

        // Extract description
        if (fieldDef.description) {
            metadata.descriptions[fieldName] = fieldDef.description;
        }

        // Extract enum values
        const enumVals = extractEnumValues(fieldDef);
        if (enumVals) {
            metadata.enumValues[fieldName] = enumVals;
        }
    }

    return metadata;
}

/**
 * Extract metadata from a discriminated union schema
 *
 * @param schema - Zod discriminated union schema
 * @returns DiscriminatedUnionMetadata with info about each variant
 */
export function extractDiscriminatedUnionMetadata(
    schema: z.ZodTypeAny
): DiscriminatedUnionMetadata {
    let def = (schema as any)._def;

    // Unwrap branded types
    if (def.typeName === 'ZodBranded' && def.type) {
        def = def.type._def;
    }

    // Handle effects (refinements, transforms, etc.)
    if (def.typeName === 'ZodEffects' && def.schema) {
        def = def.schema._def;
    }

    if (def.typeName !== 'ZodDiscriminatedUnion') {
        throw new Error(`Expected ZodDiscriminatedUnion, got ${def.typeName}`);
    }

    const discriminator = def.discriminator;
    const optionsMap = def.optionsMap;

    const metadata: DiscriminatedUnionMetadata = {
        discriminator,
        options: Array.from(optionsMap.keys()) as string[],
        schemas: {},
    };

    // Extract metadata for each option
    for (const [optionValue, optionSchema] of optionsMap.entries()) {
        metadata.schemas[optionValue as string] = extractSchemaMetadata(optionSchema);
    }

    return metadata;
}

/**
 * Extract common fields from a discriminated union (fields present in all variants)
 * Useful for extracting shared defaults like 'timeout' or 'connectionMode'
 */
export function extractCommonFields(metadata: DiscriminatedUnionMetadata): SchemaMetadata {
    const schemas = Object.values(metadata.schemas);
    if (schemas.length === 0) {
        return {
            defaults: {},
            requiredFields: [],
            fieldTypes: {},
            descriptions: {},
            enumValues: {},
        };
    }

    const first = schemas[0]!; // Safe: we checked length > 0
    const rest = schemas.slice(1);
    const common: SchemaMetadata = {
        defaults: { ...first.defaults },
        requiredFields: [...first.requiredFields],
        fieldTypes: { ...first.fieldTypes },
        descriptions: { ...first.descriptions },
        enumValues: { ...first.enumValues },
    };

    // Only keep fields that exist in ALL schemas
    for (const schema of rest) {
        // Filter defaults
        for (const key of Object.keys(common.defaults)) {
            if (!(key in schema.defaults) || schema.defaults[key] !== common.defaults[key]) {
                delete common.defaults[key];
            }
        }

        // Filter required fields
        common.requiredFields = common.requiredFields.filter((field) =>
            schema.requiredFields.includes(field)
        );

        // Filter field types (keep only if same in all schemas)
        for (const key of Object.keys(common.fieldTypes)) {
            if (!(key in schema.fieldTypes) || schema.fieldTypes[key] !== common.fieldTypes[key]) {
                delete common.fieldTypes[key];
            }
        }

        // Filter descriptions (keep only if same in all schemas)
        for (const key of Object.keys(common.descriptions)) {
            if (
                !(key in schema.descriptions) ||
                schema.descriptions[key] !== common.descriptions[key]
            ) {
                delete common.descriptions[key];
            }
        }

        // Filter enum values (keep only if same in all schemas)
        for (const key of Object.keys(common.enumValues)) {
            if (
                !(key in schema.enumValues) ||
                JSON.stringify(schema.enumValues[key]) !== JSON.stringify(common.enumValues[key])
            ) {
                delete common.enumValues[key];
            }
        }
    }

    return common;
}

/**
 * Get default value for a specific field in a discriminated union variant
 *
 * @param metadata - Discriminated union metadata
 * @param discriminatorValue - The discriminator value (e.g., 'stdio', 'http')
 * @param fieldName - The field to get default for
 * @returns The default value or undefined
 */
export function getFieldDefault(
    metadata: DiscriminatedUnionMetadata,
    discriminatorValue: string,
    fieldName: string
): unknown {
    return metadata.schemas[discriminatorValue]?.defaults[fieldName];
}

/**
 * Check if a field is required in a specific discriminated union variant
 *
 * @param metadata - Discriminated union metadata
 * @param discriminatorValue - The discriminator value (e.g., 'stdio', 'http')
 * @param fieldName - The field to check
 * @returns true if required, false otherwise
 */
export function isFieldRequiredInVariant(
    metadata: DiscriminatedUnionMetadata,
    discriminatorValue: string,
    fieldName: string
): boolean {
    return metadata.schemas[discriminatorValue]?.requiredFields.includes(fieldName) ?? false;
}
