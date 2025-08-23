import type { ResourceSet } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger/index.js';

/**
 * Supported @ reference patterns:
 * - @resource-name           -> Find by resource name (fuzzy match if needed)
 * - @<full-uri>             -> Exact URI match
 * - @server:resource-name   -> Find by server and resource name
 */

export interface ResourceReference {
    /** Original @ reference text */
    originalRef: string;
    /** Matched resource URI */
    resourceUri?: string;
    /** Type of reference pattern matched */
    type: 'name' | 'uri' | 'server-scoped';
    /** Server name (for server-scoped references) */
    serverName?: string;
    /** Resource name/identifier */
    identifier: string;
}

export interface ResourceExpansionResult {
    /** Original message with @ references expanded to content */
    expandedMessage: string;
    /** List of references that were found and expanded */
    expandedReferences: ResourceReference[];
    /** List of references that could not be resolved */
    unresolvedReferences: ResourceReference[];
}

/**
 * Parse @ references from a message
 */
export function parseResourceReferences(message: string): ResourceReference[] {
    const references: ResourceReference[] = [];

    // Single regex to match all @ reference patterns
    // Priority: URI with brackets > server:resource > simple resource name
    // Use word boundaries and negative lookbehinds to avoid matching emails and invalid patterns
    // Must be preceded by whitespace, start of string, or specific punctuation
    const regex =
        /(?<![a-zA-Z0-9])@(?:(<[^>]+>)|([a-zA-Z0-9_-]+):([a-zA-Z0-9._/-]+)|([a-zA-Z0-9._/-]+))(?![a-zA-Z0-9@.])/g;

    let match;
    while ((match = regex.exec(message)) !== null) {
        const [originalRef, uriWithBrackets, serverName, serverResource, simpleName] = match;

        if (uriWithBrackets) {
            // @<full-uri> - URI wrapped in angle brackets
            references.push({
                originalRef,
                type: 'uri',
                identifier: uriWithBrackets.slice(1, -1), // Remove < and >
            });
        } else if (serverName && serverResource) {
            // @server:resource-name - Server-scoped reference
            references.push({
                originalRef,
                type: 'server-scoped',
                serverName,
                identifier: serverResource,
            });
        } else if (simpleName) {
            // @resource-name - Simple resource name
            references.push({
                originalRef,
                type: 'name',
                identifier: simpleName,
            });
        }
    }

    return references;
}

/**
 * Resolve resource references to actual resource URIs
 */
export function resolveResourceReferences(
    references: ResourceReference[],
    availableResources: ResourceSet
): ResourceReference[] {
    const resolvedRefs = references.map((ref) => ({ ...ref }));

    for (const ref of resolvedRefs) {
        switch (ref.type) {
            case 'uri': {
                // Direct URI match - check if it exists
                if (availableResources[ref.identifier]) {
                    ref.resourceUri = ref.identifier;
                }
                break;
            }

            case 'server-scoped': {
                // Find resource by server name and resource identifier
                const serverScopedUri = findResourceByServerAndName(
                    availableResources,
                    ref.serverName!,
                    ref.identifier
                );
                if (serverScopedUri) {
                    ref.resourceUri = serverScopedUri;
                }
                break;
            }

            case 'name': {
                // Find resource by name (fuzzy matching)
                const nameMatchUri = findResourceByName(availableResources, ref.identifier);
                if (nameMatchUri) {
                    ref.resourceUri = nameMatchUri;
                }
                break;
            }
        }
    }

    return resolvedRefs;
}

/**
 * Find resource URI by server name and resource identifier
 */
function findResourceByServerAndName(
    resources: ResourceSet,
    serverName: string,
    identifier: string
): string | undefined {
    for (const [uri, resource] of Object.entries(resources)) {
        if (resource.serverName === serverName) {
            // Try exact name match first
            if (resource.name === identifier) {
                return uri;
            }
            // Try matching against original URI parts
            const originalUri = resource.metadata?.originalUri;
            if (typeof originalUri === 'string' && originalUri.includes(identifier)) {
                return uri;
            }
        }
    }
    return undefined;
}

/**
 * Find resource URI by name (with fuzzy matching)
 */
function findResourceByName(resources: ResourceSet, identifier: string): string | undefined {
    // First try exact name match
    for (const [uri, resource] of Object.entries(resources)) {
        if (resource.name === identifier) {
            return uri;
        }
    }

    // Then try partial name match
    for (const [uri, resource] of Object.entries(resources)) {
        if (resource.name?.includes(identifier)) {
            return uri;
        }
    }

    // Finally try matching against URI parts
    for (const [uri, resource] of Object.entries(resources)) {
        if (uri.includes(identifier)) {
            return uri;
        }
        const originalUri = resource.metadata?.originalUri;
        if (typeof originalUri === 'string' && originalUri.includes(identifier)) {
            return uri;
        }
    }

    return undefined;
}

/**
 * Expand resource references in a message by replacing them with actual content
 */
export async function expandResourceReferences(
    message: string,
    _resourceReader: (uri: string) => Promise<ReadResourceResult>
): Promise<ResourceExpansionResult> {
    // For now, we'll need the resource list to be passed in separately
    // This will be handled by the caller (DextoAgent)

    return {
        expandedMessage: message,
        expandedReferences: [],
        unresolvedReferences: [],
    };
}

/**
 * Format resource content for inclusion in messages
 */
export function formatResourceContent(
    resourceUri: string,
    resourceName: string,
    content: ReadResourceResult
): string {
    const contentParts: string[] = [];

    // Add header
    contentParts.push(`\n--- Content from resource: ${resourceName} (${resourceUri}) ---`);

    // Add each content item
    for (const item of content.contents) {
        if (item.text && typeof item.text === 'string') {
            contentParts.push(item.text);
        } else if (item.blob) {
            // For binary content, just add a placeholder
            const blobSize = typeof item.blob === 'string' ? item.blob.length : 'unknown';
            contentParts.push(`[Binary content: ${item.mimeType || 'unknown'}, ${blobSize} bytes]`);
        }
    }

    contentParts.push('--- End of resource content ---\n');

    return contentParts.join('\n');
}

/**
 * Main function to expand all @ references in a message
 */
export async function expandMessageReferences(
    message: string,
    availableResources: ResourceSet,
    resourceReader: (uri: string) => Promise<ReadResourceResult>
): Promise<ResourceExpansionResult> {
    logger.debug(`Expanding resource references in message: ${message.substring(0, 100)}...`);

    // Parse references from the message
    const parsedRefs = parseResourceReferences(message);
    if (parsedRefs.length === 0) {
        return {
            expandedMessage: message,
            expandedReferences: [],
            unresolvedReferences: [],
        };
    }

    logger.debug(
        `Found ${parsedRefs.length} resource references: ${parsedRefs.map((r) => r.originalRef).join(', ')}`
    );

    // Resolve references to actual resource URIs
    const resolvedRefs = resolveResourceReferences(parsedRefs, availableResources);

    // Separate resolved and unresolved references
    const expandedReferences = resolvedRefs.filter((ref) => ref.resourceUri);
    const unresolvedReferences = resolvedRefs.filter((ref) => !ref.resourceUri);

    // Log unresolved references
    if (unresolvedReferences.length > 0) {
        logger.warn(
            `Could not resolve ${unresolvedReferences.length} resource references: ${unresolvedReferences.map((r) => r.originalRef).join(', ')}`
        );
    }

    // Expand message by replacing references with content
    let expandedMessage = message;
    const failedRefs: ResourceReference[] = [];

    for (const ref of expandedReferences) {
        try {
            const content = await resourceReader(ref.resourceUri!);
            const resource = availableResources[ref.resourceUri!];
            const formattedContent = formatResourceContent(
                ref.resourceUri!,
                resource?.name || ref.identifier,
                content
            );

            // Replace the @ reference with the formatted content
            expandedMessage = expandedMessage.replace(ref.originalRef, formattedContent);

            logger.debug(
                `Expanded reference ${ref.originalRef} with ${content.contents.length} content items`
            );
        } catch (error) {
            logger.error(
                `Failed to read resource ${ref.resourceUri}: ${error instanceof Error ? error.message : String(error)}`
            );
            // Collect failed refs to move to unresolved references
            failedRefs.push(ref);
        }
    }

    // Remove failed references from expandedReferences and add to unresolvedReferences
    const failedRefSet = new Set(failedRefs);
    const finalExpandedReferences = expandedReferences.filter((ref) => !failedRefSet.has(ref));
    unresolvedReferences.push(...failedRefs);

    logger.info(
        `Expanded ${finalExpandedReferences.length} resource references, ${unresolvedReferences.length} unresolved`
    );

    return {
        expandedMessage,
        expandedReferences: finalExpandedReferences,
        unresolvedReferences,
    };
}
