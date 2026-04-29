import { z } from 'zod';
import type { JSONSchema7, JSONSchema7Definition, JSONSchema7TypeName } from 'json-schema';

function isJsonSchemaObject(schema: unknown): schema is JSONSchema7 {
    return !!schema && typeof schema === 'object' && !Array.isArray(schema);
}

function getJsonSchemaTypes(schema: JSONSchema7): JSONSchema7TypeName[] {
    const { type } = schema;
    if (Array.isArray(type)) {
        return type;
    }
    return type ? [type] : [];
}

function getJsonSchemaType(schema: JSONSchema7): JSONSchema7TypeName | undefined {
    const types = getJsonSchemaTypes(schema);
    return types.find((type) => type !== 'null') ?? types[0];
}

function hasNullableJsonSchemaType(schema: JSONSchema7): boolean {
    return getJsonSchemaTypes(schema).includes('null');
}

function getZodTypeForJsonSchemaType(
    propSchema: JSONSchema7,
    type: JSONSchema7TypeName | undefined
): z.ZodType {
    switch (type) {
        case 'string':
            return z.string();
        case 'number':
            return z.number();
        case 'integer':
            return z.number().int();
        case 'boolean':
            return z.boolean();
        case 'object':
            return z.object(jsonSchemaToZodShape(propSchema));
        case 'array': {
            const itemSchema = getPropertySchema(propSchema.items);
            return z.array(itemSchema ? getZodTypeFromProperty(itemSchema) : z.unknown());
        }
        case 'null':
            return z.null();
        default:
            return z.unknown();
    }
}

function getPropertySchema(
    schema: JSONSchema7Definition | JSONSchema7Definition[] | undefined
): JSONSchema7 | null {
    return isJsonSchemaObject(schema) ? schema : null;
}

/**
 * Converts a JSON Schema object to a Zod raw shape.
 * This is a simplified converter that handles common MCP tool schemas.
 */
export function jsonSchemaToZodShape(jsonSchema: unknown): z.ZodRawShape {
    if (!isJsonSchemaObject(jsonSchema) || getJsonSchemaType(jsonSchema) !== 'object') {
        return {};
    }

    const shape: Record<string, z.ZodType> = {};

    const properties = jsonSchema.properties ?? {};
    for (const [key, property] of Object.entries(properties)) {
        const propSchema = getPropertySchema(property);
        let zodType = propSchema ? getZodTypeFromProperty(propSchema) : z.unknown();

        if (!Array.isArray(jsonSchema.required) || !jsonSchema.required.includes(key)) {
            zodType = zodType.optional();
        }

        shape[key] = zodType;
    }

    return shape as z.ZodRawShape;
}

/**
 * Helper function to get a Zod type from a property schema
 */
export function getZodTypeFromProperty(propSchema: JSONSchema7): z.ZodType {
    const nonNullTypes = getJsonSchemaTypes(propSchema).filter(
        (type): type is Exclude<JSONSchema7TypeName, 'null'> => type !== 'null'
    );

    let zodType: z.ZodType;
    if (nonNullTypes.length === 0) {
        zodType = hasNullableJsonSchemaType(propSchema) ? z.null() : z.unknown();
    } else {
        const zodTypes = nonNullTypes.map((type) => getZodTypeForJsonSchemaType(propSchema, type));
        const [firstType, secondType, ...restTypes] = zodTypes;
        if (!firstType) {
            zodType = z.unknown();
        } else {
            zodType = secondType ? z.union([firstType, secondType, ...restTypes]) : firstType;
        }
    }

    if (hasNullableJsonSchemaType(propSchema) && nonNullTypes.length > 0) {
        zodType = zodType.nullable();
    }

    if (propSchema.description) {
        zodType = zodType.describe(propSchema.description);
    }

    return zodType;
}
