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
 * - Each function should be named clearly to reflect its purpose (e.g., getCurrentDateTime, getResourceData).
 */

export async function getCurrentDateTime(_context: DynamicContributorContext): Promise<string> {
    return `<dateTime>Current date and time: ${new Date().toISOString()}</dateTime>`;
}

// TODO: This needs to be optimized to only fetch resources when needed. Currently this runs every time the prompt is generated.
export async function getResourceData(context: DynamicContributorContext): Promise<string> {
    const resources = await context.mcpManager.listAllResources();
    if (!resources || resources.length === 0) {
        return '<resources></resources>';
    }
    const parts = await Promise.all(
        resources.map(async (resource) => {
            try {
                const response = await context.mcpManager.readResource(resource.key);
                const first = response?.contents?.[0];
                let content: string;
                if (first?.text && typeof first.text === 'string') {
                    content = first.text;
                } else if (first?.blob && typeof first.blob === 'string') {
                    content = first.blob;
                } else {
                    content = JSON.stringify(response, null, 2);
                }
                const label = resource.summary.name || resource.summary.uri;
                return `<resource uri="${resource.key}" name="${label}">${content}</resource>`;
            } catch (error: any) {
                return `<resource uri="${resource.key}">Error loading resource: ${
                    error.message || error
                }</resource>`;
            }
        })
    );
    return `<resources>\n${parts.join('\n')}\n</resources>`;
}
