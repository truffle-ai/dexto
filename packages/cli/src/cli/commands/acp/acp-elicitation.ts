import type * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';

/**
 * Dexto's form schema (ask_user, MCP elicitation) as an ACP form. ACP forms take typed
 * properties only, so a schema with any other field cannot be shown and gives null.
 */
const FormSchema = z.object({
    type: z.literal('object').optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), z.object({ type: z.string() }).passthrough()),
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
