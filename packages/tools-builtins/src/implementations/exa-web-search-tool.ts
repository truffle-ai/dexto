import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { callExaTool } from './exa-mcp.js';

const WebSearchInputSchema = z
    .object({
        query: z.string().min(1).describe('Web search query'),
        numResults: z
            .number()
            .int()
            .positive()
            .optional()
            .default(8)
            .describe('Number of results to return (default: 8)'),
        livecrawl: z
            .enum(['fallback', 'preferred'])
            .optional()
            .default('fallback')
            .describe(
                "Live crawl mode - 'fallback' uses cached content when available, 'preferred' prioritizes live crawling"
            ),
        type: z
            .enum(['auto', 'fast'])
            .optional()
            .default('auto')
            .describe("Search type - 'auto' (default) or 'fast'"),
        contextMaxCharacters: z
            .number()
            .int()
            .positive()
            .optional()
            .default(10000)
            .describe('Maximum context length in characters (default: 10000)'),
    })
    .strict();
/**
 * Create the `web_search` tool.
 *
 * Performs a web search by calling Exa's MCP endpoint via the MCP SDK.
 */
export function createWebSearchTool(): Tool {
    return defineTool({
        id: 'web_search',
        displayName: 'Web Search',
        description:
            'Search the web for current information and return clean, ready-to-use text. Use for news, facts, and up-to-date context.',
        inputSchema: WebSearchInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const { query, numResults, livecrawl, type, contextMaxCharacters } = input;

            return await callExaTool({
                logger: context.logger,
                toolId: 'web_search',
                toolName: 'web_search_exa',
                args: {
                    query,
                    numResults,
                    livecrawl,
                    type,
                    contextMaxCharacters,
                },
                timeoutMs: 25000,
            });
        },
    });
}
