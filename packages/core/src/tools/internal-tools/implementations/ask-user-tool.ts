import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { ApprovalManager } from '../../../approval/manager.js';

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

type AskUserInput = z.input<typeof AskUserInputSchema>;

/**
 * Internal tool for asking the user questions during agent execution
 * Leverages the ApprovalManager to prompt the user cross-platform (CLI, WebUI)
 *
 * Usage distinction:
 * - ask_user tool: Agent-initiated form-based input requests during task execution
 *   (e.g., agent decides it needs specific information to complete a task)
 * - MCP elicitation: Server-initiated input requests from external MCP servers
 *   (e.g., MCP server requires configuration or authentication data)
 *
 * Both use ApprovalManager.requestElicitation() under the hood but serve different purposes:
 * - ask_user: Part of agent's internal reasoning and task workflow
 * - MCP elicitation: External server requirements for tool/resource access
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
                schema: Record<string, unknown>;
                prompt: string;
                serverName: string;
                sessionId?: string;
            } = {
                schema,
                prompt: question,
                serverName: 'Dexto Agent',
            };

            // Add sessionId if available
            if (context?.sessionId !== undefined) {
                elicitationRequest.sessionId = context.sessionId;
            }

            // Delegate to shared helper for typed errors and consistent logic
            return approvalManager.getElicitationData(elicitationRequest);
        },
    };
}
