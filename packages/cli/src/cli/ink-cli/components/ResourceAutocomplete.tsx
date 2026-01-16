import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../hooks/useInputOrchestrator.js';
import type { ResourceMetadata } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';

export interface ResourceAutocompleteHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ResourceAutocompleteProps {
    isVisible: boolean;
    searchQuery: string;
    onSelectResource: (resource: ResourceMetadata) => void;
    onLoadIntoInput?: (text: string) => void; // New prop for Tab key
    onClose: () => void;
    agent: DextoAgent;
}

/**
 * Get match score for resource: 0 = no match, 1 = description/URI match, 2 = name includes, 3 = name starts with
 * Prioritizes name matches over description/URI matches
 */
function getResourceMatchScore(resource: ResourceMetadata, query: string): number {
    if (!query) return 3; // Show all when no query
    const lowerQuery = query.toLowerCase();
    const name = (resource.name || '').toLowerCase();
    const uri = resource.uri.toLowerCase();
    const uriFilename = uri.split('/').pop()?.toLowerCase() || '';
    const description = (resource.description || '').toLowerCase();

    // Highest priority: name starts with query
    if (name.startsWith(lowerQuery)) {
        return 4;
    }

    // Second priority: name includes query
    if (name.includes(lowerQuery)) {
        return 3;
    }

    // Third priority: URI filename starts with query
    if (uriFilename.startsWith(lowerQuery)) {
        return 2;
    }

    // Fourth priority: URI filename includes query
    if (uriFilename.includes(lowerQuery)) {
        return 2;
    }

    // Fifth priority: URI includes query
    if (uri.includes(lowerQuery)) {
        return 1;
    }

    // Lowest priority: description includes query
    if (description.includes(lowerQuery)) {
        return 1;
    }

    return 0; // No match
}

/**
 * Check if resource matches query (for filtering)
 */
function matchesQuery(resource: ResourceMetadata, query: string): boolean {
    return getResourceMatchScore(resource, query) > 0;
}

/**
 * Sort resources by match score (highest first), then alphabetically
 */
function sortResources(resources: ResourceMetadata[], query: string): ResourceMetadata[] {
    if (!query) return resources;

    const lowerQuery = query.toLowerCase();
    return [...resources].sort((a, b) => {
        const scoreA = getResourceMatchScore(a, lowerQuery);
        const scoreB = getResourceMatchScore(b, lowerQuery);

        // Sort by score first (higher score first)
        if (scoreA !== scoreB) {
            return scoreB - scoreA;
        }

        // If scores are equal, sort alphabetically by name
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        return aName.localeCompare(bName);
    });
}

/**
 * Inner component - wrapped with React.memo below
 */
const ResourceAutocompleteInner = forwardRef<ResourceAutocompleteHandle, ResourceAutocompleteProps>(
    function ResourceAutocomplete(
        { isVisible, searchQuery, onSelectResource, onLoadIntoInput, onClose, agent },
        ref
    ) {
        const [resources, setResources] = useState<ResourceMetadata[]>([]);
        const [isLoading, setIsLoading] = useState(false);
        // Combined state to guarantee single render on navigation
        const [selection, setSelection] = useState({ index: 0, offset: 0 });
        const selectedIndexRef = useRef(0);
        const MAX_VISIBLE_ITEMS = 5;

        // Update selection AND scroll offset in a single state update
        // This guarantees exactly one render per navigation action
        const updateSelection = useCallback(
            (indexUpdater: number | ((prev: number) => number)) => {
                setSelection((prev) => {
                    const newIndex =
                        typeof indexUpdater === 'function'
                            ? indexUpdater(prev.index)
                            : indexUpdater;
                    selectedIndexRef.current = newIndex;

                    // Calculate new scroll offset
                    let newOffset = prev.offset;
                    if (newIndex < prev.offset) {
                        newOffset = newIndex;
                    } else if (newIndex >= prev.offset + MAX_VISIBLE_ITEMS) {
                        newOffset = Math.max(0, newIndex - MAX_VISIBLE_ITEMS + 1);
                    }

                    return { index: newIndex, offset: newOffset };
                });
            },
            [MAX_VISIBLE_ITEMS]
        );

        // Fetch resources from agent
        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;
            setIsLoading(true);

            const fetchResources = async () => {
                try {
                    const resourceSet = await agent.listResources();
                    const resourceList: ResourceMetadata[] = Object.values(resourceSet);
                    if (!cancelled) {
                        setResources(resourceList);
                        setIsLoading(false);
                    }
                } catch {
                    if (!cancelled) {
                        // Silently fail - don't use console.error as it interferes with Ink rendering
                        setResources([]);
                        setIsLoading(false);
                    }
                }
            };

            void fetchResources();

            return () => {
                cancelled = true;
            };
        }, [isVisible, agent]);

        // NOTE: Auto-close logic is handled synchronously in TextBufferInput.tsx
        // (on backspace deleting @ and on space after @). We don't use useEffect here
        // because React batches state updates, causing race conditions where isVisible
        // and searchQuery update at different times.

        // Extract query from @mention (everything after @)
        const mentionQuery = useMemo(() => {
            // Find the last @ that's at start or after space
            const atIndex = searchQuery.lastIndexOf('@');
            if (atIndex === -1) return '';

            // Check if @ is at start or preceded by space
            const prevChar = searchQuery[atIndex - 1];
            if (atIndex === 0 || (prevChar && /\s/.test(prevChar))) {
                return searchQuery.slice(atIndex + 1).trim();
            }
            return '';
        }, [searchQuery]);

        // Filter and sort resources (no limit - scrolling handles it)
        const filteredResources = useMemo(() => {
            const matched = resources.filter((r) => matchesQuery(r, mentionQuery));
            return sortResources(matched, mentionQuery);
        }, [resources, mentionQuery]);

        // Track items length for reset detection
        const prevItemsLengthRef = useRef(filteredResources.length);
        const itemsChanged = filteredResources.length !== prevItemsLengthRef.current;

        // Derive clamped selection values during render (always valid, no setState needed)
        // This prevents the double-render that was causing flickering
        const selectedIndex = itemsChanged
            ? 0
            : Math.min(selection.index, Math.max(0, filteredResources.length - 1));
        const scrollOffset = itemsChanged
            ? 0
            : Math.min(selection.offset, Math.max(0, filteredResources.length - MAX_VISIBLE_ITEMS));

        // Sync state only when items actually changed AND state differs
        // This effect runs AFTER render, updating state for next user interaction
        useEffect(() => {
            if (itemsChanged) {
                prevItemsLengthRef.current = filteredResources.length;
                // Only setState if values actually differ (prevents unnecessary re-render)
                if (selection.index !== 0 || selection.offset !== 0) {
                    selectedIndexRef.current = 0;
                    setSelection({ index: 0, offset: 0 });
                } else {
                    selectedIndexRef.current = 0;
                }
            }
        }, [itemsChanged, filteredResources.length, selection.index, selection.offset]);

        // Calculate visible items based on scroll offset
        const visibleResources = useMemo(() => {
            return filteredResources.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
        }, [filteredResources, scrollOffset, MAX_VISIBLE_ITEMS]);

        // Expose handleInput method via ref
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (_input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Escape always closes, regardless of item count
                    if (key.escape) {
                        onClose();
                        return true;
                    }

                    const itemsLength = filteredResources.length;
                    if (itemsLength === 0) return false;

                    if (key.upArrow) {
                        updateSelection((prev) => (prev - 1 + itemsLength) % itemsLength);
                        return true;
                    }

                    if (key.downArrow) {
                        updateSelection((prev) => (prev + 1) % itemsLength);
                        return true;
                    }

                    // Tab to load into input (for editing before selection)
                    if (key.tab) {
                        const resource = filteredResources[selectedIndexRef.current];
                        if (!resource) return false;

                        // Get the @ position and construct the text to load
                        const atIndex = searchQuery.lastIndexOf('@');
                        if (atIndex >= 0) {
                            const before = searchQuery.slice(0, atIndex + 1);
                            const uriParts = resource.uri.split('/');
                            const reference =
                                resource.name || uriParts[uriParts.length - 1] || resource.uri;
                            onLoadIntoInput?.(`${before}${reference}`);
                        } else {
                            // Fallback: just append @resource
                            const uriParts = resource.uri.split('/');
                            const reference =
                                resource.name || uriParts[uriParts.length - 1] || resource.uri;
                            onLoadIntoInput?.(`${searchQuery}@${reference}`);
                        }
                        return true;
                    }

                    // Enter to select
                    if (key.return) {
                        const resource = filteredResources[selectedIndexRef.current];
                        if (resource) {
                            onSelectResource(resource);
                            return true;
                        }
                    }

                    // Don't consume other keys (typing, backspace, etc.)
                    return false;
                },
            }),
            [
                isVisible,
                filteredResources,
                selectedIndexRef,
                searchQuery,
                onClose,
                onLoadIntoInput,
                onSelectResource,
                updateSelection,
            ]
        );

        if (!isVisible) return null;

        if (isLoading) {
            return (
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray">Loading resources...</Text>
                </Box>
            );
        }

        if (filteredResources.length === 0) {
            return (
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray">
                        {mentionQuery
                            ? `No resources match "${mentionQuery}"`
                            : 'No resources available. Connect an MCP server or enable internal resources.'}
                    </Text>
                </Box>
            );
        }

        const totalItems = filteredResources.length;

        return (
            <Box flexDirection="column">
                <Box paddingX={0} paddingY={0}>
                    <Text color="yellowBright" bold>
                        Resources ({selectedIndex + 1}/{totalItems}) - ↑↓ navigate, Tab load, Enter
                        select, Esc close
                    </Text>
                </Box>
                {visibleResources.map((resource, visibleIndex) => {
                    const actualIndex = scrollOffset + visibleIndex;
                    const isSelected = actualIndex === selectedIndex;
                    const uriParts = resource.uri.split('/');
                    const displayName =
                        resource.name || uriParts[uriParts.length - 1] || resource.uri;
                    const isImage = (resource.mimeType || '').startsWith('image/');

                    // Truncate URI for display (show last 40 chars with ellipsis)
                    const truncatedUri =
                        resource.uri.length > 50 ? '…' + resource.uri.slice(-49) : resource.uri;

                    return (
                        <Box key={resource.uri}>
                            {isImage && <Text color={isSelected ? 'cyan' : 'gray'}>🖼️ </Text>}
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {displayName}
                            </Text>
                            {resource.serverName && (
                                <Text color="gray"> [{resource.serverName}]</Text>
                            )}
                            <Text color="gray"> {truncatedUri}</Text>
                        </Box>
                    );
                })}
            </Box>
        );
    }
);

/**
 * Export with React.memo to prevent unnecessary re-renders from parent
 * Only re-renders when props actually change (shallow comparison)
 */
const ResourceAutocomplete = React.memo(
    ResourceAutocompleteInner
) as typeof ResourceAutocompleteInner;

export default ResourceAutocomplete;
