import type { ResourceSet } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logger/index.js';

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
}

export function parseResourceReferences(message: string): ResourceReference[] {
    const references: ResourceReference[] = [];
    const regex =
        /(?<![a-zA-Z0-9])@(?:(<[^>]+>)|([a-zA-Z0-9_-]+):([a-zA-Z0-9._/-]+)|([a-zA-Z0-9._/-]+))(?![a-zA-Z0-9@.])/g;
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
                if (availableResources[ref.identifier]) ref.resourceUri = ref.identifier;
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

function findResourceByServerAndName(
    resources: ResourceSet,
    serverName: string,
    identifier: string
): string | undefined {
    for (const [uri, resource] of Object.entries(resources)) {
        if (resource.serverName === serverName) {
            if (resource.name === identifier) return uri;
            const originalUri = resource.metadata?.originalUri;
            if (typeof originalUri === 'string' && originalUri.includes(identifier)) return uri;
        }
    }
    return undefined;
}

function findResourceByName(resources: ResourceSet, identifier: string): string | undefined {
    for (const [uri, resource] of Object.entries(resources)) {
        if (resource.name === identifier) return uri;
    }
    for (const [uri, resource] of Object.entries(resources)) {
        if (resource.name?.includes(identifier)) return uri;
    }
    for (const [uri, resource] of Object.entries(resources)) {
        if (uri.includes(identifier)) return uri;
        const originalUri = resource.metadata?.originalUri;
        if (typeof originalUri === 'string' && originalUri.includes(identifier)) return uri;
    }
    return undefined;
}

export async function expandResourceReferences(
    message: string,
    _resourceReader: (uri: string) => Promise<ReadResourceResult>
): Promise<ResourceExpansionResult> {
    return { expandedMessage: message, expandedReferences: [], unresolvedReferences: [] };
}

export function formatResourceContent(
    resourceUri: string,
    resourceName: string,
    content: ReadResourceResult
): string {
    const contentParts: string[] = [];
    contentParts.push(`\n--- Content from resource: ${resourceName} (${resourceUri}) ---`);
    for (const item of content.contents) {
        if (item.text && typeof item.text === 'string') {
            contentParts.push(item.text);
        } else if (item.blob) {
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
    logger.debug(`Expanding resource references in message: ${message.substring(0, 100)}...`);
    const parsedRefs = parseResourceReferences(message);
    if (parsedRefs.length === 0) {
        return { expandedMessage: message, expandedReferences: [], unresolvedReferences: [] };
    }

    logger.debug(
        `Found ${parsedRefs.length} resource references: ${parsedRefs.map((r) => r.originalRef).join(', ')}`
    );
    const resolvedRefs = resolveResourceReferences(parsedRefs, availableResources);
    const expandedReferences = resolvedRefs.filter((ref) => ref.resourceUri);
    const unresolvedReferences = resolvedRefs.filter((ref) => !ref.resourceUri);

    if (unresolvedReferences.length > 0) {
        logger.warn(
            `Could not resolve ${unresolvedReferences.length} resource references: ${unresolvedReferences.map((r) => r.originalRef).join(', ')}`
        );
    }

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
            expandedMessage = expandedMessage.replace(ref.originalRef, formattedContent);
            logger.debug(
                `Expanded reference ${ref.originalRef} with ${content.contents.length} content items`
            );
        } catch (error) {
            logger.error(
                `Failed to read resource ${ref.resourceUri}: ${error instanceof Error ? error.message : String(error)}`
            );
            failedRefs.push(ref);
        }
    }

    const failedRefSet = new Set(failedRefs);
    const finalExpandedReferences = expandedReferences.filter((ref) => !failedRefSet.has(ref));
    unresolvedReferences.push(...failedRefs);
    logger.info(
        `Expanded ${finalExpandedReferences.length} resource references, ${unresolvedReferences.length} unresolved`
    );

    return { expandedMessage, expandedReferences: finalExpandedReferences, unresolvedReferences };
}
