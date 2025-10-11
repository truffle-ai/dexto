import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { ApprovalManager } from '../../../approval/manager.js';

const AskUserInputSchema = z.object({
    question: z.string().describe('The question or prompt to display to the user'),
    schema: z
        .object({
            type: z.literal('object'),
            properties: z.record(z.any()),
            required: z.array(z.string()).optional(),
        })
        .passthrough()
        .describe(
            'JSON Schema defining the form structure. Must be an object with "type": "object" and "properties" defining form fields. Use "enum" arrays for dropdowns, "boolean" for yes/no, "number"/"integer" for numeric inputs, "string" for text. Include "required" array for mandatory fields.'
        ),
});

type AskUserInput = z.input<typeof AskUserInputSchema>;

/**
 * Internal tool for asking the user questions during agent execution
 * Leverages the ApprovalManager to prompt the user cross-platform (CLI, WebUI)
 */
export function createAskUserTool(approvalManager: ApprovalManager): InternalTool {
    return {
        id: 'ask_user',
        description:
            'Collect structured input from the user through a form interface. ONLY use this tool when you need: 1) Multiple fields at once (e.g., name + email + preferences), 2) Pre-defined options/choices (use enum for dropdowns like ["small","medium","large"]), 3) Specific data types with validation (boolean for yes/no, number for quantities). DO NOT use for simple conversational questions - just ask those naturally in your response. This tool is for form-like data collection, not chat. Examples: collecting user profile info, configuration settings, or selecting from preset options.',
        inputSchema: AskUserInputSchema,
        execute: async (input: unknown, context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { question, schema } = input as AskUserInput;

            // Build elicitation request
            const elicitationRequest: {
                schema: Record<string, any>;
                prompt: string;
                serverName: string;
                sessionId?: string;
            } = {
                schema: schema,
                prompt: question,
                serverName: 'Dexto Agent',
            };

            // Add sessionId if available
            if (context?.sessionId !== undefined) {
                elicitationRequest.sessionId = context.sessionId;
            }

            // Request elicitation through ApprovalManager
            const approvalResponse = await approvalManager.requestElicitation(elicitationRequest);

            // Handle response
            if (approvalResponse.status === 'approved' && approvalResponse.data) {
                const formData = (approvalResponse.data as any).formData;
                return formData;
            } else if (approvalResponse.status === 'denied') {
                throw new Error('User declined to answer the question');
            } else {
                // cancelled
                throw new Error('User cancelled the question');
            }
        },
    };
}
