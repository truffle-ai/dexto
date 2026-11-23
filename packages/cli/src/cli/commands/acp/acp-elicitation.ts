import type * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';

/**
 * Dexto's form schema (ask_user, MCP elicitation) as an ACP form. ACP forms take only string,
 * number, integer, boolean and multi-select string fields, in the shapes ACP's own validator
 * accepts; any other field means the form cannot be shown and gives null. Keys ACP does not
 * know (such as `x-dexto`) are dropped.
 */
const UINT32_MAX = 4294967295;
const Text = { title: z.string().optional(), description: z.string().optional() };
const EnumOption = z.object({
    const: z.string(),
    title: z.string(),
    description: z.string().optional(),
});

const Property = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('string'),
        ...Text,
        minLength: z.number().int().nonnegative().max(UINT32_MAX).optional(),
        maxLength: z.number().int().nonnegative().max(UINT32_MAX).optional(),
        pattern: z.string().optional(),
        format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
        default: z.string().optional(),
        enum: z.array(z.string()).optional(),
        oneOf: z.array(EnumOption).optional(),
    }),
    z.object({
        type: z.literal('number'),
        ...Text,
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        default: z.number().optional(),
    }),
    z.object({
        type: z.literal('integer'),
        ...Text,
        minimum: z.number().int().optional(),
        maximum: z.number().int().optional(),
        default: z.number().int().optional(),
    }),
    z.object({ type: z.literal('boolean'), ...Text, default: z.boolean().optional() }),
    z.object({
        type: z.literal('array'),
        ...Text,
        minItems: z.number().int().nonnegative().optional(),
        maxItems: z.number().int().nonnegative().optional(),
        // ask_user describes multi-select as `items: { enum }`; ACP needs the item type.
        items: z.union([
            z
                .object({ type: z.literal('string').optional(), enum: z.array(z.string()) })
                .transform(({ enum: values }) => ({ type: 'string' as const, enum: values })),
            z.object({ anyOf: z.array(EnumOption) }),
        ]),
        default: z.array(z.string()).optional(),
    }),
]);

const FormSchema = z.object({
    type: z.literal('object').optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), Property),
    required: z.array(z.string()).optional(),
});

export function formSchema(schema: unknown): acp.ElicitationSchema | null {
    const parsed = FormSchema.safeParse(schema);
    if (!parsed.success) return null;
    const { title, description, properties, required } = parsed.data;
    return {
        type: 'object',
        properties,
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(required !== undefined ? { required } : {}),
    };
}
