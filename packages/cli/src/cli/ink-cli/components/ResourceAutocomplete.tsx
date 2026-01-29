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
import path from 'path';
import type { Key } from '../hooks/useInputOrchestrator.js';
import type { ResourceMetadata } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';
import { centerTruncatePath } from '../utils/messageFormatting.js';

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
 * Unified display item (can be file or directory)
 */
interface DisplayItem {
    path: string; // Relative path (e.g., "packages/cli/src/file.ts" or "packages/")
    isDirectory: boolean;
    resource?: ResourceMetadata; // Defined for files, undefined for directories
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
    const uriFilename = uri.split(/[\\/]/).pop()?.toLowerCase() || '';
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

        // Extract directories and create display items (hybrid search)
        const displayItems = useMemo(() => {
            const items: DisplayItem[] = [];
            const directories = new Set<string>();

            // Process each resource to extract paths and directories
            resources.forEach((resource) => {
                // Convert URI to relative path
                let relativePath = resource.uri;
                const rawUri = relativePath.replace(/^(fs|file):\/\//, '');

                if (path.isAbsolute(rawUri)) {
                    try {
                        const relPath = path.relative(process.cwd(), rawUri);
                        if (relPath && !relPath.startsWith('..')) {
                            relativePath = relPath;
                        } else {
                            // Outside cwd, use name as fallback
                            const uriParts = resource.uri.split(/[\\/]/);
                            relativePath =
                                resource.name || uriParts[uriParts.length - 1] || resource.uri;
                        }
                    } catch {
                        return; // Skip if path conversion fails
                    }
                }

                // Add file item
                items.push({
                    path: relativePath,
                    isDirectory: false,
                    resource,
                });

                // Extract all parent directories (1-2 levels deep)
                const segments = relativePath.split(path.sep).filter(Boolean);
                for (let i = 0; i < Math.min(segments.length - 1, 2); i++) {
                    const dirPath = segments.slice(0, i + 1).join(path.sep) + path.sep;
                    directories.add(dirPath);
                }
            });

            // Add directory items
            directories.forEach((dirPath) => {
                items.push({
                    path: dirPath,
                    isDirectory: true,
                });
            });

            // Filter by query
            const filtered = items.filter((item) => {
                if (!mentionQuery) return true; // Show all when no query

                const lowerQuery = mentionQuery.toLowerCase();
                const lowerPath = item.path.toLowerCase();
                const pathParts = item.path.split(path.sep).filter(Boolean);
                const lastSegment = pathParts[pathParts.length - 1]?.toLowerCase() || '';

                // Match against filename/dirname or full path
                if (lastSegment.includes(lowerQuery) || lowerPath.includes(lowerQuery)) {
                    return true;
                }

                // Also match against resource name and description (for files)
                if (item.resource) {
                    const lowerName = (item.resource.name || '').toLowerCase();
                    const lowerDescription = (item.resource.description || '').toLowerCase();
                    if (lowerName.includes(lowerQuery) || lowerDescription.includes(lowerQuery)) {
                        return true;
                    }
                }

                return false;
            });

            // Sort by relevance
            return filtered.sort((a, b) => {
                if (!mentionQuery) {
                    // No query: directories first, then alphabetically
                    if (a.isDirectory !== b.isDirectory) {
                        return a.isDirectory ? -1 : 1;
                    }
                    return a.path.localeCompare(b.path);
                }

                const lowerQuery = mentionQuery.toLowerCase();
                const aPathParts = a.path.split(path.sep).filter(Boolean);
                const bPathParts = b.path.split(path.sep).filter(Boolean);
                const aLastSegment = aPathParts[aPathParts.length - 1]?.toLowerCase() || '';
                const bLastSegment = bPathParts[bPathParts.length - 1]?.toLowerCase() || '';

                // Score by match quality
                const aStartsWith = aLastSegment.startsWith(lowerQuery);
                const bStartsWith = bLastSegment.startsWith(lowerQuery);
                const aIncludes = aLastSegment.includes(lowerQuery);
                const bIncludes = bLastSegment.includes(lowerQuery);

                // Priority 1: Prefix matches
                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;

                // Priority 2: Substring matches
                if (aIncludes && !bIncludes) return -1;
                if (!aIncludes && bIncludes) return 1;

                // Priority 3: Shallower paths first
                const depthDiff = aPathParts.length - bPathParts.length;
                if (depthDiff !== 0) return depthDiff;

                // Priority 4: Alphabetically
                return a.path.localeCompare(b.path);
            });
        }, [resources, mentionQuery]);

        // Track items length for reset detection
        const prevItemsLengthRef = useRef(displayItems.length);
        const itemsChanged = displayItems.length !== prevItemsLengthRef.current;

        // Derive clamped selection values during render (always valid, no setState needed)
        // This prevents the double-render that was causing flickering
        const selectedIndex = itemsChanged
            ? 0
            : Math.min(selection.index, Math.max(0, displayItems.length - 1));
        const scrollOffset = itemsChanged
            ? 0
            : Math.min(selection.offset, Math.max(0, displayItems.length - MAX_VISIBLE_ITEMS));

        // Sync state only when items actually changed AND state differs
        // This effect runs AFTER render, updating state for next user interaction
        useEffect(() => {
            if (itemsChanged) {
                prevItemsLengthRef.current = displayItems.length;
                // Only setState if values actually differ (prevents unnecessary re-render)
                if (selection.index !== 0 || selection.offset !== 0) {
                    selectedIndexRef.current = 0;
                    setSelection({ index: 0, offset: 0 });
                } else {
                    selectedIndexRef.current = 0;
                }
            }
        }, [itemsChanged, displayItems.length, selection.index, selection.offset]);

        // Calculate visible items based on scroll offset
        const visibleResources = useMemo(() => {
            return displayItems.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
        }, [displayItems, scrollOffset, MAX_VISIBLE_ITEMS]);

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

                    const itemsLength = displayItems.length;
                    if (itemsLength === 0) return false;

                    if (key.upArrow) {
                        updateSelection((prev) => (prev - 1 + itemsLength) % itemsLength);
                        return true;
                    }

                    if (key.downArrow) {
                        updateSelection((prev) => (prev + 1) % itemsLength);
                        return true;
                    }

                    // Tab to load into input (for editing/browsing)
                    if (key.tab) {
                        const item = displayItems[selectedIndexRef.current];
                        if (!item) return false;

                        const atIndex = searchQuery.lastIndexOf('@');
                        const reference = item.path; // Already a relative path

                        if (atIndex >= 0) {
                            const before = searchQuery.slice(0, atIndex + 1);
                            onLoadIntoInput?.(`${before}${reference}`);
                        } else {
                            onLoadIntoInput?.(`${searchQuery}@${reference}`);
                        }
                        return true;
                    }

                    // Enter to select (directories drill down, files select)
                    if (key.return) {
                        const item = displayItems[selectedIndexRef.current];
                        if (!item) return false;

                        if (item.isDirectory) {
                            // Drill down into directory
                            const atIndex = searchQuery.lastIndexOf('@');
                            if (atIndex >= 0) {
                                const before = searchQuery.slice(0, atIndex + 1);
                                onLoadIntoInput?.(`${before}${item.path}`);
                            } else {
                                onLoadIntoInput?.(`${searchQuery}@${item.path}`);
                            }
                        } else if (item.resource) {
                            // Select the file resource
                            onSelectResource(item.resource);
                        }
                        return true;
                    }

                    // Don't consume other keys (typing, backspace, etc.)
                    return false;
                },
            }),
            [
                isVisible,
                displayItems,
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

        if (displayItems.length === 0) {
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

        return (
            <Box flexDirection="column" paddingLeft={2}>
                {visibleResources.map((item, visibleIndex) => {
                    const actualIndex = scrollOffset + visibleIndex;
                    const isSelected = actualIndex === selectedIndex;

                    // Use center truncation for long paths
                    const displayPath = centerTruncatePath(item.path, 60);

                    // Check if it's an image file
                    const isImage = item.resource?.mimeType?.startsWith('image/');

                    return (
                        <Box key={item.path}>
                            <Text color={isSelected ? 'cyan' : 'gray'}>
                                {isSelected ? '❯ ' : '  '}
                            </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {isImage && '🖼️  '}
                                {displayPath}
                                {item.resource?.serverName && ` [${item.resource.serverName}]`}
                            </Text>
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
