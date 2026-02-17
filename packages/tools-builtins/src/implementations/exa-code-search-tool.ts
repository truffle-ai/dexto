import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { callExaTool } from './exa-mcp.js';

const CodeSearchInputSchema = z
    .object({
        query: z
            .string()
            .min(1)
            .describe(
                "Search query for code examples and documentation (e.g., 'React useState examples', 'Express middleware', 'Python pandas dataframe filtering')"
            ),
        tokensNum: z
            .number()
            .int()
            .min(1000)
            .max(50000)
            .optional()
            .default(5000)
            .describe('Approximate token budget to return (1000–50000, default: 5000)'),
    })
    .strict();

type CodeSearchInput = z.output<typeof CodeSearchInputSchema>;

/**
 * Create the `code_search` tool.
 *
 * Finds relevant code snippets and documentation by calling Exa's MCP endpoint via the MCP SDK.
 */
export function createCodeSearchTool(): Tool {
    return {
        id: 'code_search',
        displayName: 'CodeSearch',
        description:
            'Search for code examples and documentation across sources like official docs, GitHub, and Stack Overflow. Returns formatted text context.',
        inputSchema: CodeSearchInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { query, tokensNum } = input as CodeSearchInput;

            return await callExaTool({
                logger: context.logger,
                toolId: 'code_search',
                toolName: 'get_code_context_exa',
                args: {
                    query,
                    tokensNum,
                },
                timeoutMs: 30000,
            });
        },
    };
}
