import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ResourceMetadata } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';

interface ResourceAutocompleteProps {
    isVisible: boolean;
    searchQuery: string;
    onSelectResource: (resource: ResourceMetadata) => void;
    onClose: () => void;
    agent: DextoAgent;
}

/**
 * Simple fuzzy match - checks if query matches resource name, URI, or description
 */
function matchesQuery(resource: ResourceMetadata, query: string): boolean {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    const name = (resource.name || '').toLowerCase();
    const uri = resource.uri.toLowerCase();
    const description = (resource.description || '').toLowerCase();

    return (
        name.includes(lowerQuery) ||
        uri.includes(lowerQuery) ||
        description.includes(lowerQuery) ||
        name.startsWith(lowerQuery) || // Prioritize prefix matches
        (uri.split('/').pop()?.toLowerCase().startsWith(lowerQuery) ?? false) // Match filename
    );
}

/**
 * Sort resources: exact matches first, then prefix matches, then substring matches
 */
function sortResources(resources: ResourceMetadata[], query: string): ResourceMetadata[] {
    if (!query) return resources;

    const lowerQuery = query.toLowerCase();
    return resources.sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        const aUri = a.uri.toLowerCase();
        const bUri = b.uri.toLowerCase();

        // Exact match
        const aExact = aName === lowerQuery || aUri === lowerQuery;
        const bExact = bName === lowerQuery || bUri === lowerQuery;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // Prefix match
        const aPrefix = aName.startsWith(lowerQuery) || aUri.startsWith(lowerQuery);
        const bPrefix = bName.startsWith(lowerQuery) || bUri.startsWith(lowerQuery);
        if (aPrefix && !bPrefix) return -1;
        if (!aPrefix && bPrefix) return 1;

        // Substring match
        const aSubstring = aName.includes(lowerQuery) || aUri.includes(lowerQuery);
        const bSubstring = bName.includes(lowerQuery) || bUri.includes(lowerQuery);
        if (aSubstring && !bSubstring) return -1;
        if (!aSubstring && bSubstring) return 1;

        // Alphabetical by name
        return aName.localeCompare(bName);
    });
}

export default function ResourceAutocomplete({
    isVisible,
    searchQuery,
    onSelectResource,
    onClose,
    agent,
}: ResourceAutocompleteProps) {
    const [resources, setResources] = useState<ResourceMetadata[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);
    const MAX_VISIBLE_ITEMS = 8; // Number of items visible at once

    // Keep ref in sync
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

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
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to fetch resources:', error);
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

    // Reset selected index and scroll when resources change
    useEffect(() => {
        setSelectedIndex(0);
        setScrollOffset(0);
    }, [filteredResources.length]);

    // Auto-scroll to keep selected item visible
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            // Selected item is above visible area, scroll up
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            // Selected item is below visible area, scroll down
            setScrollOffset(Math.max(0, selectedIndex - MAX_VISIBLE_ITEMS + 1));
        }
    }, [selectedIndex, scrollOffset]);

    // Calculate visible items based on scroll offset
    const visibleResources = useMemo(() => {
        return filteredResources.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    }, [filteredResources, scrollOffset]);

    // Handle keyboard navigation
    useInput(
        (input, key) => {
            if (!isVisible) return;

            const itemsLength = filteredResources.length;
            if (itemsLength === 0) return;

            switch (key.upArrow) {
                case true:
                    setSelectedIndex((prev) => (prev - 1 + itemsLength) % itemsLength);
                    break;
            }

            switch (key.downArrow) {
                case true:
                    setSelectedIndex((prev) => (prev + 1) % itemsLength);
                    break;
            }

            switch (key.escape) {
                case true:
                    onClose();
                    break;
            }

            // Tab or Enter to select
            if ((key.tab || key.return) && itemsLength > 0) {
                const resource = filteredResources[selectedIndexRef.current];
                if (resource) {
                    onSelectResource(resource);
                }
            }
        },
        { isActive: isVisible }
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>Loading resources...</Text>
            </Box>
        );
    }

    if (filteredResources.length === 0) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>
                    {mentionQuery
                        ? `No resources match "${mentionQuery}"`
                        : 'No resources available. Connect an MCP server or enable internal resources.'}
                </Text>
            </Box>
        );
    }

    const hasMoreAbove = scrollOffset > 0;
    const hasMoreBelow = scrollOffset + MAX_VISIBLE_ITEMS < filteredResources.length;
    const totalItems = filteredResources.length;

    return (
        <Box
            borderStyle="single"
            borderColor="yellow"
            flexDirection="column"
            height={MAX_VISIBLE_ITEMS + 3}
        >
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>
                    Resources ({selectedIndex + 1}/{totalItems}) - ↑↓ to navigate, Tab/Enter to
                    select, Esc to close
                </Text>
            </Box>
            {hasMoreAbove && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>... ↑ ({scrollOffset} more above)</Text>
                </Box>
            )}
            {visibleResources.map((resource, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;
                const uriParts = resource.uri.split('/');
                const displayName = resource.name || uriParts[uriParts.length - 1] || resource.uri;
                const isImage = (resource.mimeType || '').startsWith('image/');

                return (
                    <Box
                        key={resource.uri}
                        paddingX={1}
                        paddingY={0}
                        backgroundColor={isSelected ? 'yellow' : undefined}
                    >
                        <Box flexDirection="column">
                            <Box>
                                {isImage && <Text color={isSelected ? 'black' : 'cyan'}>🖼️ </Text>}
                                <Text color={isSelected ? 'black' : 'green'} bold>
                                    {displayName}
                                </Text>
                                {resource.serverName && (
                                    <Box marginLeft={1}>
                                        <Text
                                            color={isSelected ? 'black' : 'yellow'}
                                            dimColor={!isSelected}
                                        >
                                            [{resource.serverName}]
                                        </Text>
                                    </Box>
                                )}
                            </Box>
                            <Box marginLeft={isImage ? 3 : 0}>
                                <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                                    {resource.uri}
                                </Text>
                            </Box>
                            {resource.description && (
                                <Box marginLeft={isImage ? 3 : 0}>
                                    <Text
                                        color={isSelected ? 'black' : 'gray'}
                                        dimColor={!isSelected}
                                    >
                                        {resource.description}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    </Box>
                );
            })}
            {hasMoreBelow && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>
                        ... ↓ ({totalItems - scrollOffset - MAX_VISIBLE_ITEMS} more below)
                    </Text>
                </Box>
            )}
        </Box>
    );
}
