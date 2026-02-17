import { z } from 'zod';
import { ToolError, defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';

const AskUserInputSchema = z
    .object({
        question: z.string().describe('The question or prompt to display to the user'),
        schema: z
            .object({
                type: z.literal('object'),
                properties: z.record(z.unknown()),
                required: z.array(z.string()).optional(),
            })
            .passthrough()
            .describe(
                'JSON Schema defining form fields. Use descriptive property names as labels (e.g., "favorite_team", "World Cup winner country") - NOT generic names like "q1". Use "enum" for dropdowns, "boolean" for yes/no, "number" for numeric inputs, "string" for text. Include "required" array for mandatory fields.'
            ),
    })
    .strict();

/**
 * Create the `ask_user` tool.
 *
 * Uses the approval/elicitation channel to collect structured user input via a JSON Schema form.
 * Requires `ToolExecutionContext.services.approval`.
 */
export function createAskUserTool(): Tool {
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
                schema,
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
