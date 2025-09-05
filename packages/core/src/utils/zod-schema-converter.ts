import { z } from 'zod';

/**
 * Converts a JSON Schema object to a Zod raw shape.
 * This is a simplified converter that handles common MCP tool schemas.
 */
export function jsonSchemaToZodShape(jsonSchema: any): z.ZodRawShape {
    if (!jsonSchema || typeof jsonSchema !== 'object' || jsonSchema.type !== 'object') {
        return {};
    }

    const shape: z.ZodRawShape = {};

    if (jsonSchema.properties) {
        for (const [key, property] of Object.entries(jsonSchema.properties)) {
            const propSchema = property as any;
            let zodType: z.ZodTypeAny;
            switch (propSchema.type) {
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
                case 'array':
                    if (propSchema.items) {
                        const itemType = getZodTypeFromProperty(propSchema.items);
                        zodType = z.array(itemType);
                    } else {
                        zodType = z.array(z.any());
                    }
                    break;
                case 'object':
                    zodType = z.object(jsonSchemaToZodShape(propSchema));
                    break;
                default:
                    zodType = z.any();
            }

            // Add description if present using custom metadata
            if (propSchema.description) {
                // Try to add description as custom property (this might get picked up by the SDK)
                (zodType as any)._def.description = propSchema.description;
                zodType = zodType.describe(propSchema.description);
            }

            // Make optional if not in required array
            if (!jsonSchema.required || !jsonSchema.required.includes(key)) {
                zodType = zodType.optional();
            }

            shape[key] = zodType;
        }
    }

    return shape;
}

/**
 * Helper function to get a Zod type from a property schema
 */
export function getZodTypeFromProperty(propSchema: any): z.ZodTypeAny {
    let zodType: z.ZodTypeAny;

    switch (propSchema.type) {
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
            if (propSchema.items) {
                zodType = z.array(getZodTypeFromProperty(propSchema.items));
            } else {
                zodType = z.array(z.any());
            }
            break;
        default:
            zodType = z.any();
    }

    // Add description if present using custom metadata
    if (propSchema.description) {
        // Try to add description as custom property (this might get picked up by the SDK)
        (zodType as any)._def.description = propSchema.description;
        zodType = zodType.describe(propSchema.description);
    }

    return zodType;
}
