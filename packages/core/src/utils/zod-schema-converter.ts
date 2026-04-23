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
    let zodType: z.ZodType;
    const primaryType = getJsonSchemaType(propSchema);

    switch (primaryType) {
        case 'string':
            zodType = z.string();
            break;
        case 'number':
            zodType = z.number();
            break;
        case 'integer':
            zodType = z.number().int();
            break;
        case 'boolean':
            zodType = z.boolean();
            break;
        case 'object':
            zodType = z.object(jsonSchemaToZodShape(propSchema));
            break;
        case 'array':
            {
                const itemSchema = getPropertySchema(propSchema.items);
                if (itemSchema) {
                    zodType = z.array(getZodTypeFromProperty(itemSchema));
                } else {
                    zodType = z.array(z.unknown());
                }
            }
            break;
        case 'null':
            zodType = z.null();
            break;
        default:
            zodType = z.unknown();
    }

    if (hasNullableJsonSchemaType(propSchema) && primaryType !== 'null') {
        zodType = zodType.nullable();
    }

    if (propSchema.description) {
        zodType = zodType.describe(propSchema.description);
    }

    return zodType;
}
