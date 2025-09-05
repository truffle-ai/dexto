import { DynamicContributorContext } from './types.js';

/**
 * Dynamic Prompt Generators
 *
 * This module contains functions for generating dynamic system prompts for the AI agent.
 * Each function should return a string (or Promise<string>) representing a prompt, possibly using the provided context.
 *
 * ---
 * Guidelines for Adding Prompt Functions:
 * - Place all dynamic prompt-generating functions in this file.
 * - Also update the `registry.ts` file to register the new function.
 * - Use XML tags to indicate the start and end of the dynamic prompt - they are known to improve performance
 * - Each function should be named clearly to reflect its purpose (e.g., getCurrentDateTime, getMemorySummary).
 */

export async function getCurrentDateTime(_context: DynamicContributorContext): Promise<string> {
    return `<dateTime>Current date and time: ${new Date().toISOString()}</dateTime>`;
}

export async function getMemorySummary(_context: DynamicContributorContext): Promise<string> {
    // Placeholder for actual memory logic
    return '<memorySummary>Memory summary: [not implemented]</memorySummary>';
}

// TODO: This needs to be optimized to only fetch resources when needed. Curerntly this runs every time the prompt is generated.
export async function getResourceData(context: DynamicContributorContext): Promise<string> {
    const uris = await context.mcpManager.listAllResources();
    if (!uris || uris.length === 0) {
        return '<resources></resources>';
    }
    const parts = await Promise.all(
        uris.map(async (uri) => {
            try {
                const response = await context.mcpManager.readResource(uri);
                let content: string;
                if (typeof response === 'string') {
                    content = response;
                } else if (response && typeof response === 'object') {
                    if ('content' in response && typeof response.content === 'string') {
                        content = response.content;
                    } else {
                        content = JSON.stringify(response, null, 2);
                    }
                } else {
                    content = String(response);
                }
                return `<resource uri="${uri}">${content}</resource>`;
            } catch (error: any) {
                return `<resource uri="${uri}">Error loading resource: ${error.message || error}</resource>`;
            }
        })
    );
    return `<resources>\n${parts.join('\n')}\n</resources>`;
}
