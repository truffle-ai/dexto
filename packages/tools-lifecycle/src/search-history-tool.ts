import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { SearchOptions } from '@dexto/core';
import { ToolError } from '@dexto/core';

const SearchHistoryInputSchema = z
    .object({
        query: z.string().describe('The search query to find in conversation history'),
        mode: z
            .enum(['messages', 'sessions'])
            .describe(
                'Search mode: "messages" searches for individual messages, "sessions" finds sessions containing the query'
            ),
        sessionId: z
            .string()
            .optional()
            .describe('Optional: limit search to a specific session (only for mode="messages")'),
        role: z
            .enum(['user', 'assistant', 'system', 'tool'])
            .optional()
            .describe('Optional: filter by message role (only for mode="messages")'),
        limit: z
            .number()
            .optional()
            .default(20)
            .describe(
                'Optional: maximum number of results to return (default: 20, only for mode="messages")'
            ),
        offset: z
            .number()
            .optional()
            .default(0)
            .describe('Optional: offset for pagination (default: 0, only for mode="messages")'),
    })
    .strict();

type SearchHistoryInput = z.input<typeof SearchHistoryInputSchema>;

/**
 * Create the `search_history` tool.
 *
 * Searches message/session history using the configured SearchService.
 * Requires `ToolExecutionContext.services.search`.
 */
export function createSearchHistoryTool(): Tool {
    return {
        id: 'search_history',
        description:
            'Search through conversation history across sessions. Use mode="messages" to search for specific messages, or mode="sessions" to find sessions containing the query. For message search, you can filter by sessionId (specific session), role (user/assistant/system/tool), limit results, and set pagination offset.',
        inputSchema: SearchHistoryInputSchema,
        execute: async (input: unknown, context: ToolExecutionContext) => {
            const { query, mode, sessionId, role, limit, offset } = input as SearchHistoryInput;

            const searchService = context.services?.search;
            if (!searchService) {
                throw ToolError.configInvalid(
                    'search_history requires ToolExecutionContext.services.search'
                );
            }

            if (mode === 'messages') {
                const searchOptions: SearchOptions = {};
                if (sessionId !== undefined) searchOptions.sessionId = sessionId;
                if (role !== undefined) searchOptions.role = role;
                if (limit !== undefined) searchOptions.limit = limit;
                if (offset !== undefined) searchOptions.offset = offset;

                return await searchService.searchMessages(query, searchOptions);
            }

            return await searchService.searchSessions(query);
        },
    };
}
