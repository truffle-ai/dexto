import type { ResourceSet } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// TODO: Implement Option A - pass logger as optional parameter for better observability
// when we refactor to injectable logger pattern (see CLAUDE.md note about future logger architecture)

export interface ResourceReference {
    originalRef: string;
    resourceUri?: string;
    type: 'name' | 'uri' | 'server-scoped';
    serverName?: string;
    identifier: string;
}

export interface ResourceExpansionResult {
    expandedMessage: string;
    expandedReferences: ResourceReference[];
    unresolvedReferences: ResourceReference[];
    extractedImages: Array<{ image: string; mimeType: string; name: string }>;
}

function escapeRegExp(literal: string): string {
    return literal.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Parse resource references from a message.
 *
 * @ symbols are only treated as resource references if they:
 * 1. Are at the start of the message, OR
 * 2. Are preceded by whitespace
 *
 * This means email addresses like "user@example.com" are NOT treated as references.
 */
export function parseResourceReferences(message: string): ResourceReference[] {
    const references: ResourceReference[] = [];
    // Require whitespace before @ or start of string (^)
    // This prevents matching @ in email addresses like user@example.com
    const regex =
        /(?:^|(?<=\s))@(?:(<[^>]+>)|([a-zA-Z0-9_-]+):([a-zA-Z0-9._/-]+)|([a-zA-Z0-9._/-]+))(?![a-zA-Z0-9@.])/g;
    let match;
    while ((match = regex.exec(message)) !== null) {
        const [originalRef, uriWithBrackets, serverName, serverResource, simpleName] = match;
        if (uriWithBrackets) {
            references.push({ originalRef, type: 'uri', identifier: uriWithBrackets.slice(1, -1) });
        } else if (serverName && serverResource) {
            references.push({
                originalRef,
                type: 'server-scoped',
                serverName,
                identifier: serverResource,
            });
        } else if (simpleName) {
            references.push({ originalRef, type: 'name', identifier: simpleName });
        }
    }
    return references;
}

export function resolveResourceReferences(
    references: ResourceReference[],
    availableResources: ResourceSet
): ResourceReference[] {
    const resolvedRefs = references.map((ref) => ({ ...ref }));
    for (const ref of resolvedRefs) {
        switch (ref.type) {
            case 'uri': {
                // Try direct lookup first
                if (availableResources[ref.identifier]) {
                    ref.resourceUri = ref.identifier;
                } else {
                    // Fall back to searching by originalUri in metadata
                    const uriMatchUri = findResourceByOriginalUri(
                        availableResources,
                        ref.identifier
                    );
                    if (uriMatchUri) ref.resourceUri = uriMatchUri;
                }
                break;
            }
            case 'server-scoped': {
                const serverScopedUri = findResourceByServerAndName(
                    availableResources,
                    ref.serverName!,
                    ref.identifier
                );
                if (serverScopedUri) ref.resourceUri = serverScopedUri;
                break;
            }
            case 'name': {
                const nameMatchUri = findResourceByName(availableResources, ref.identifier);
                if (nameMatchUri) ref.resourceUri = nameMatchUri;
                break;
            }
        }
    }
    return resolvedRefs;
}

function findResourceByOriginalUri(resources: ResourceSet, uri: string): string | undefined {
    const normalizedUri = uri.trim().toLowerCase();

    // Look for exact match in originalUri metadata
    for (const [resourceUri, resource] of Object.entries(resources)) {
        const originalUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (originalUri && originalUri.toLowerCase() === normalizedUri) {
            return resourceUri;
        }
    }

    // Fall back to partial match
    for (const [resourceUri, resource] of Object.entries(resources)) {
        const originalUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (originalUri && originalUri.toLowerCase().includes(normalizedUri)) {
            return resourceUri;
        }
    }

    return undefined;
}

function findResourceByServerAndName(
    resources: ResourceSet,
    serverName: string,
    identifier: string
): string | undefined {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const matchingResources = Object.entries(resources).filter(
        ([, resource]) => resource.serverName === serverName
    );

    for (const [uri, resource] of matchingResources) {
        if (!resource.name) continue;
        const normalizedName = resource.name.trim().toLowerCase();
        if (
            normalizedName === normalizedIdentifier ||
            normalizedName.includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    for (const [uri, resource] of matchingResources) {
        const metadataUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (
            metadataUri?.toLowerCase().includes(normalizedIdentifier) ||
            uri.toLowerCase().includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    return undefined;
}

function findResourceByName(resources: ResourceSet, identifier: string): string | undefined {
    const normalizedIdentifier = identifier.trim().toLowerCase();

    for (const [uri, resource] of Object.entries(resources)) {
        if (!resource.name) continue;
        const normalizedName = resource.name.trim().toLowerCase();
        if (
            normalizedName === normalizedIdentifier ||
            normalizedName.includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    for (const [uri, resource] of Object.entries(resources)) {
        const originalUri =
            typeof resource.metadata?.originalUri === 'string'
                ? resource.metadata.originalUri
                : undefined;
        if (
            originalUri?.toLowerCase().includes(normalizedIdentifier) ||
            uri.toLowerCase().includes(normalizedIdentifier)
        ) {
            return uri;
        }
    }

    return undefined;
}

export function formatResourceContent(
    resourceUri: string,
    resourceName: string,
    content: ReadResourceResult
): string {
    const contentParts: string[] = [];
    contentParts.push(`\n--- Content from resource: ${resourceName} (${resourceUri}) ---`);
    for (const item of content.contents) {
        if ('text' in item && item.text && typeof item.text === 'string') {
            contentParts.push(item.text);
        } else if ('blob' in item && item.blob) {
            const blobSize = typeof item.blob === 'string' ? item.blob.length : 'unknown';
            contentParts.push(`[Binary content: ${item.mimeType || 'unknown'}, ${blobSize} bytes]`);
        }
    }
    contentParts.push('--- End of resource content ---\n');
    return contentParts.join('\n');
}

export async function expandMessageReferences(
    message: string,
    availableResources: ResourceSet,
    resourceReader: (uri: string) => Promise<ReadResourceResult>
): Promise<ResourceExpansionResult> {
    // Note: Logging removed to keep this function browser-safe
    // TODO: Add logger as optional parameter when implementing Option A

    const parsedRefs = parseResourceReferences(message);
    if (parsedRefs.length === 0) {
        return {
            expandedMessage: message,
            expandedReferences: [],
            unresolvedReferences: [],
            extractedImages: [],
        };
    }

    const resolvedRefs = resolveResourceReferences(parsedRefs, availableResources);
    const expandedReferences = resolvedRefs.filter((ref) => ref.resourceUri);
    const unresolvedReferences = resolvedRefs.filter((ref) => !ref.resourceUri);

    let expandedMessage = message;
    const failedRefs: ResourceReference[] = [];
    const extractedImages: Array<{ image: string; mimeType: string; name: string }> = [];

    for (const ref of expandedReferences) {
        try {
            const content = await resourceReader(ref.resourceUri!);
            const resource = availableResources[ref.resourceUri!];

            // Check if this is an image resource
            let isImageResource = false;
            for (const item of content.contents) {
                if (
                    'blob' in item &&
                    item.blob &&
                    item.mimeType &&
                    item.mimeType.startsWith('image/') &&
                    typeof item.blob === 'string'
                ) {
                    extractedImages.push({
                        image: item.blob,
                        mimeType: item.mimeType,
                        name: resource?.name || ref.identifier,
                    });
                    isImageResource = true;
                    break;
                }
            }

            if (isImageResource) {
                // Remove the reference from the message for images
                const pattern = new RegExp(escapeRegExp(ref.originalRef), 'g');
                expandedMessage = expandedMessage
                    .replace(pattern, ' ')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
            } else {
                // For non-image resources, expand them inline as before
                const formattedContent = formatResourceContent(
                    ref.resourceUri!,
                    resource?.name || ref.identifier,
                    content
                );
                const pattern = new RegExp(escapeRegExp(ref.originalRef), 'g');
                expandedMessage = expandedMessage.replace(pattern, formattedContent);
            }
        } catch (_error) {
            failedRefs.push(ref);
        }
    }

    const failedRefSet = new Set(failedRefs);
    const finalExpandedReferences = expandedReferences.filter((ref) => !failedRefSet.has(ref));
    unresolvedReferences.push(...failedRefs);

    return {
        expandedMessage,
        expandedReferences: finalExpandedReferences,
        unresolvedReferences,
        extractedImages,
    };
}
