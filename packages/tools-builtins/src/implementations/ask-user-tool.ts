import { z } from 'zod';
import { ToolError, defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';

const AskUserInputSchema = z
    .object({
        question: z
            .string()
            .describe(
                'High-level prompt/title for the form. Keep this short; clients may display or ignore it.'
            ),
        schema: z
            .object({
                type: z.literal('object'),
                properties: z.record(z.unknown()),
                required: z.array(z.string()).optional(),
            })
            .passthrough()
            .describe(
                [
                    'JSON Schema defining form fields (object schema only).',
                    'Deterministic UI mapping (recommended):',
                    '- `properties[field].title`: main question/label shown prominently (keep ≲ 80 chars).',
                    '- `properties[field].description`: optional help text (keep ≲ 120 chars).',
                    '- `properties[field][\"x-dexto\"].stepLabel`: short wizard/step label (keep ≲ 16 chars).',
                    'Use stable, descriptive property keys (avoid generic names like "q1").',
                    'Use `enum` for single-choice lists, `boolean` for yes/no, `number` for numeric inputs, `string` for text.',
                    'For multi-select, use `type: \"array\"` with `items: { enum: [...] }`.',
                    'Include a top-level `required` array for mandatory fields.',
                ].join(' ')
            ),
    })
    .strict();

function toTitleCase(value: string): string {
    return value
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join(' ');
}

function enrichSchemaTitles(schema: Record<string, unknown>): Record<string, unknown> {
    if (schema.type !== 'object') return schema;
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object') return schema;

    const nextProperties: Record<string, unknown> = { ...(properties as Record<string, unknown>) };

    for (const [key, value] of Object.entries(nextProperties)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const prop = value as Record<string, unknown>;
        const title = typeof prop.title === 'string' ? prop.title.trim() : '';
        if (title) continue;
        prop.title = toTitleCase(key);
    }

    return { ...schema, properties: nextProperties };
}

/**
 * Create the `ask_user` tool.
 *
 * Uses the approval/elicitation channel to collect structured user input via a JSON Schema form.
 * Requires `ToolExecutionContext.services.approval`.
 */
export function createAskUserTool(): Tool<typeof AskUserInputSchema> {
    return defineTool({
        id: 'ask_user',
        displayName: 'Ask',
        description:
            'Collect structured input from the user through a form interface. ONLY use this tool when you need: 1) Multiple fields at once (e.g., name + email + preferences), 2) Pre-defined options/choices (use enum for dropdowns like ["small","medium","large"]), 3) Specific data types with validation (boolean for yes/no, number for quantities). DO NOT use for simple conversational questions - just ask those naturally in your response. This tool is for form-like data collection, not chat. Examples: collecting user profile info, configuration settings, or selecting from preset options.',
        inputSchema: AskUserInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const { question, schema } = input;

            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'ask_user requires ToolExecutionContext.services.approval'
                );
            }

            const elicitationRequest: {
                schema: Record<string, unknown>;
                prompt: string;
                serverName: string;
                sessionId?: string;
            } = {
                schema: enrichSchemaTitles(schema as unknown as Record<string, unknown>),
                prompt: question,
                serverName: 'Dexto Agent',
            };

            if (context.sessionId !== undefined) {
                elicitationRequest.sessionId = context.sessionId;
            }

            return approvalManager.getElicitationData(elicitationRequest);
        },
    });
}
