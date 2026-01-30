/**
 * ToolBrowser Component
 * Interactive browser for exploring available tools
 * Features:
 * - Search/filter tools by name
 * - View tool details (description, schema)
 * - Shows source (MCP server or Internal)
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent } from '@dexto/core';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { writeToClipboard } from '../../utils/clipboardUtils.js';

interface ToolBrowserProps {
    isVisible: boolean;
    onClose: () => void;
    agent: DextoAgent;
}

export interface ToolBrowserHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ToolInfo {
    name: string;
    description: string;
    source: 'internal' | 'mcp';
    serverName: string | undefined;
    inputSchema: Record<string, unknown> | undefined;
}

type ViewMode = 'list' | 'detail';

const MAX_VISIBLE_ITEMS = 12;
const MAX_DETAIL_LINES = 15;

/**
 * Tool browser with search and detail views
 */
const ToolBrowser = forwardRef<ToolBrowserHandle, ToolBrowserProps>(function ToolBrowser(
    { isVisible, onClose, agent },
    ref
) {
    const { columns, rows } = useTerminalSize();
    const [tools, setTools] = useState<ToolInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [scrollOffset, setScrollOffset] = useState(0);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
    const [detailScrollOffset, setDetailScrollOffset] = useState(0);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const selectedIndexRef = useRef(selectedIndex);
    const viewModeRef = useRef(viewMode);
    const detailScrollOffsetRef = useRef(detailScrollOffset);
    const detailMaxScrollOffsetRef = useRef(0);
    const selectedToolRef = useRef<ToolInfo | null>(null);

    // Keep refs in sync
    selectedIndexRef.current = selectedIndex;
    viewModeRef.current = viewMode;
    detailScrollOffsetRef.current = detailScrollOffset;
    selectedToolRef.current = selectedTool;

    // Fetch tools from agent
    useEffect(() => {
        if (!isVisible) return;

        let cancelled = false;
        setIsLoading(true);
        setSearchQuery('');
        setSelectedIndex(0);
        setScrollOffset(0);
        setViewMode('list');
        setSelectedTool(null);

        const fetchTools = async () => {
            try {
                const [allTools, mcpTools] = await Promise.all([
                    agent.getAllTools(),
                    agent.getAllMcpTools(),
                ]);

                const toolList: ToolInfo[] = [];
                const mcpToolNames = new Set(Object.keys(mcpTools));

                for (const [toolName, toolInfo] of Object.entries(allTools)) {
                    const isMcpTool = mcpToolNames.has(toolName) || toolName.startsWith('mcp--');

                    // Extract server name from MCP tool name (format: mcp--serverName--toolName)
                    let serverName: string | undefined;
                    if (toolName.startsWith('mcp--')) {
                        const parts = toolName.split('--');
                        if (parts.length >= 2) {
                            serverName = parts[1];
                        }
                    }

                    toolList.push({
                        name: toolName,
                        description: toolInfo.description || 'No description available',
                        source: isMcpTool ? 'mcp' : 'internal',
                        serverName,
                        inputSchema: toolInfo.parameters as Record<string, unknown> | undefined,
                    });
                }

                // Sort: internal tools first, then MCP tools
                toolList.sort((a, b) => {
                    if (a.source !== b.source) {
                        return a.source === 'internal' ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                });

                if (!cancelled) {
                    setTools(toolList);
                    setIsLoading(false);
                }
            } catch (error) {
                if (!cancelled) {
                    setTools([]);
                    setIsLoading(false);
                }
            }
        };

        void fetchTools();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent]);

    // Filter tools based on search query
    const filteredTools = useMemo((): ToolInfo[] => {
        if (!searchQuery.trim()) {
            return tools;
        }

        const query = searchQuery.toLowerCase();
        return tools.filter((tool) => {
            const name = tool.name.toLowerCase();
            const desc = tool.description.toLowerCase();
            const server = (tool.serverName || '').toLowerCase();
            return name.includes(query) || desc.includes(query) || server.includes(query);
        });
    }, [tools, searchQuery]);

    // Adjust selected index when filter changes
    useEffect(() => {
        if (selectedIndex >= filteredTools.length) {
            setSelectedIndex(Math.max(0, filteredTools.length - 1));
        }
    }, [filteredTools.length, selectedIndex]);

    // Calculate scroll offset
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            setScrollOffset(selectedIndex - MAX_VISIBLE_ITEMS + 1);
        }
    }, [selectedIndex, scrollOffset]);

    // Handle showing tool details
    const showToolDetails = (tool: ToolInfo) => {
        setSelectedTool(tool);
        setViewMode('detail');
        setDetailScrollOffset(0);
    };

    // Handle going back to list
    const goBackToList = () => {
        setViewMode('list');
        setSelectedTool(null);
    };

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // In detail view (use ref to get latest value)
                if (viewModeRef.current === 'detail') {
                    if (key.escape || key.backspace || key.delete) {
                        goBackToList();
                        return true;
                    }
                    // Handle scrolling in detail view - check refs before setState to avoid flicker
                    if (key.upArrow) {
                        if (detailScrollOffsetRef.current > 0) {
                            setDetailScrollOffset((prev) => prev - 1);
                        }
                        return true;
                    }
                    if (key.downArrow) {
                        if (detailScrollOffsetRef.current < detailMaxScrollOffsetRef.current) {
                            setDetailScrollOffset((prev) => prev + 1);
                        }
                        return true;
                    }
                    // Copy schema to clipboard
                    if (input === 'c' || input === 'C') {
                        const tool = selectedToolRef.current;
                        if (tool) {
                            const schema = {
                                type: 'function',
                                name: tool.name,
                                description: tool.description,
                                parameters: tool.inputSchema || {},
                            };
                            void writeToClipboard(JSON.stringify(schema, null, 2)).then(
                                (success) => {
                                    setCopyFeedback(success ? 'Copied!' : 'Copy failed');
                                    setTimeout(() => setCopyFeedback(null), 1500);
                                }
                            );
                        }
                        return true;
                    }
                    return true; // Consume all input in detail view
                }

                // In list view
                // Escape closes
                if (key.escape) {
                    onClose();
                    return true;
                }

                // Handle character input for search
                if (input && !key.return && !key.upArrow && !key.downArrow && !key.tab) {
                    // Backspace
                    if (key.backspace || key.delete) {
                        setSearchQuery((prev) => prev.slice(0, -1));
                        return true;
                    }

                    // Regular character - add to search
                    if (input.length === 1 && input.charCodeAt(0) >= 32) {
                        setSearchQuery((prev) => prev + input);
                        setSelectedIndex(0);
                        setScrollOffset(0);
                        return true;
                    }
                }

                // Backspace when no other input
                if (key.backspace || key.delete) {
                    setSearchQuery((prev) => prev.slice(0, -1));
                    return true;
                }

                const itemsLength = filteredTools.length;
                if (itemsLength === 0) return false;

                if (key.upArrow) {
                    const nextIndex = (selectedIndexRef.current - 1 + itemsLength) % itemsLength;
                    setSelectedIndex(nextIndex);
                    selectedIndexRef.current = nextIndex;
                    return true;
                }

                if (key.downArrow) {
                    const nextIndex = (selectedIndexRef.current + 1) % itemsLength;
                    setSelectedIndex(nextIndex);
                    selectedIndexRef.current = nextIndex;
                    return true;
                }

                if (key.return && itemsLength > 0) {
                    const tool = filteredTools[selectedIndexRef.current];
                    if (tool) {
                        showToolDetails(tool);
                        return true;
                    }
                }

                return false;
            },
        }),
        [isVisible, filteredTools, onClose, viewMode]
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">Loading tools...</Text>
            </Box>
        );
    }

    // Detail view
    if (viewMode === 'detail' && selectedTool) {
        // Calculate max visible lines based on terminal height
        const maxVisibleLines = Math.min(18, Math.max(5, rows - 6)); // Cap at 18 to reduce flicker
        return (
            <ToolDetailView
                tool={selectedTool}
                columns={columns}
                scrollOffset={detailScrollOffset}
                maxVisibleLines={maxVisibleLines}
                maxScrollOffsetRef={detailMaxScrollOffsetRef}
                copyFeedback={copyFeedback}
            />
        );
    }

    // List view
    const visibleTools = filteredTools.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    // Show counts based on filtered results, not total
    const filteredInternalCount = filteredTools.filter((t) => t.source === 'internal').length;
    const filteredMcpCount = filteredTools.filter((t) => t.source === 'mcp').length;

    return (
        <Box flexDirection="column" width={columns}>
            {/* Header */}
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Tool Browser
                </Text>
                <Text color="gray">
                    {' '}
                    ({filteredTools.length} tools: {filteredInternalCount} internal,{' '}
                    {filteredMcpCount} MCP)
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">↑↓ navigate, Enter view details, Esc close</Text>
            </Box>

            {/* Search input */}
            <Box paddingX={0} paddingY={0} marginTop={1}>
                <Text color="gray">Search: </Text>
                <Text color={searchQuery ? 'white' : 'gray'}>
                    {searchQuery || 'Type to filter...'}
                </Text>
                <Text color="cyan">▌</Text>
            </Box>

            {/* Separator */}
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">{'─'.repeat(Math.min(60, columns - 2))}</Text>
            </Box>

            {/* Tools list */}
            {filteredTools.length === 0 ? (
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray">No tools match your search</Text>
                </Box>
            ) : (
                visibleTools.map((tool, visibleIndex) => {
                    const actualIndex = scrollOffset + visibleIndex;
                    const isSelected = actualIndex === selectedIndex;

                    return (
                        <Box key={tool.name} paddingX={0} paddingY={0}>
                            <Text color={isSelected ? 'cyan' : 'white'}>
                                {isSelected ? '▶ ' : '  '}
                            </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {truncateText(tool.name, 35)}
                            </Text>
                            <Text color={tool.source === 'internal' ? 'magenta' : 'blue'}>
                                {' '}
                                [{tool.source === 'internal' ? 'Internal' : 'MCP'}]
                            </Text>
                            {tool.serverName && <Text color="gray"> ({tool.serverName})</Text>}
                        </Box>
                    );
                })
            )}

            {/* Scroll indicator */}
            {filteredTools.length > MAX_VISIBLE_ITEMS && (
                <Box paddingX={0} paddingY={0} marginTop={1}>
                    <Text color="gray">
                        {scrollOffset > 0 ? '↑ more above' : ''}
                        {scrollOffset > 0 && scrollOffset + MAX_VISIBLE_ITEMS < filteredTools.length
                            ? ' | '
                            : ''}
                        {scrollOffset + MAX_VISIBLE_ITEMS < filteredTools.length
                            ? '↓ more below'
                            : ''}
                    </Text>
                </Box>
            )}
        </Box>
    );
});

/**
 * Content line types for detail view
 */
type DetailLineType =
    | { type: 'title'; text: string }
    | { type: 'source'; source: 'internal' | 'mcp'; serverName: string | undefined }
    | { type: 'empty' }
    | { type: 'header'; text: string }
    | { type: 'description'; text: string }
    | { type: 'param-name'; name: string; paramType: string; required: boolean }
    | { type: 'param-desc'; text: string }
    | { type: 'param-enum'; values: string[] };

/**
 * Build detail line data for a tool (plain data, not React elements)
 */
function buildDetailLineData(tool: ToolInfo, maxWidth: number): DetailLineType[] {
    const lines: DetailLineType[] = [];

    // Tool name
    lines.push({ type: 'title', text: tool.name });

    // Source
    lines.push({ type: 'source', source: tool.source, serverName: tool.serverName });

    // Empty line before description
    lines.push({ type: 'empty' });

    // Description header
    lines.push({ type: 'header', text: 'Description:' });

    // Description content (wrapped)
    const descriptionLines = wrapText(tool.description, maxWidth - 2).split('\n');
    for (const descLine of descriptionLines) {
        lines.push({ type: 'description', text: descLine });
    }

    // Parameters section
    if (tool.inputSchema) {
        const properties = tool.inputSchema.properties as
            | Record<string, Record<string, unknown>>
            | undefined;
        const required = (tool.inputSchema.required as string[]) || [];

        if (properties && Object.keys(properties).length > 0) {
            // Empty line before parameters
            lines.push({ type: 'empty' });

            // Parameters header
            lines.push({ type: 'header', text: 'Parameters:' });

            // Each parameter
            for (const [propName, propSchema] of Object.entries(properties)) {
                const paramType = (propSchema.type as string) || 'any';
                const description = propSchema.description as string | undefined;
                const isRequired = required.includes(propName);
                const enumValues = propSchema.enum as string[] | undefined;

                // Parameter name line
                lines.push({
                    type: 'param-name',
                    name: propName,
                    paramType,
                    required: isRequired,
                });

                // Parameter description (wrapped)
                if (description) {
                    const paramDescLines = wrapText(description, maxWidth - 6).split('\n');
                    for (const paramDescLine of paramDescLines) {
                        lines.push({ type: 'param-desc', text: paramDescLine });
                    }
                }

                // Enum values
                if (enumValues) {
                    lines.push({ type: 'param-enum', values: enumValues });
                }

                // Empty line between parameters
                lines.push({ type: 'empty' });
            }
        } else {
            // Empty line before "no parameters"
            lines.push({ type: 'empty' });
            lines.push({ type: 'param-desc', text: 'No parameters' });
        }
    }

    return lines;
}

/**
 * Render a single detail line from data
 */
function renderDetailLine(line: DetailLineType, index: number): React.ReactNode {
    switch (line.type) {
        case 'title':
            return (
                <Text color="cyan" bold>
                    {line.text}
                </Text>
            );
        case 'source':
            return (
                <>
                    <Text color="gray">Source: </Text>
                    <Text color={line.source === 'internal' ? 'magenta' : 'blue'}>
                        {line.source === 'internal' ? 'Internal' : 'MCP'}
                    </Text>
                    {line.serverName && <Text color="gray"> (server: {line.serverName})</Text>}
                </>
            );
        case 'empty':
            return <Text> </Text>;
        case 'header':
            return <Text color="gray">{line.text}</Text>;
        case 'description':
            return (
                <>
                    <Text> </Text>
                    <Text>{line.text}</Text>
                </>
            );
        case 'param-name':
            return (
                <>
                    <Text> </Text>
                    <Text color="cyan">{line.name}</Text>
                    <Text color="gray"> ({line.paramType})</Text>
                    {line.required && <Text color="red"> *required</Text>}
                </>
            );
        case 'param-desc':
            return (
                <>
                    <Text> </Text>
                    <Text color="gray">{line.text}</Text>
                </>
            );
        case 'param-enum':
            return (
                <>
                    <Text> </Text>
                    <Text color="gray">Allowed: {line.values.join(' | ')}</Text>
                </>
            );
    }
}

/**
 * Tool detail view component with scrolling support
 */
function ToolDetailView({
    tool,
    columns,
    scrollOffset,
    maxVisibleLines,
    maxScrollOffsetRef,
    copyFeedback,
}: {
    tool: ToolInfo;
    columns: number;
    scrollOffset: number;
    maxVisibleLines: number;
    maxScrollOffsetRef: React.MutableRefObject<number>;
    copyFeedback: string | null;
}) {
    const maxWidth = Math.min(80, columns - 4);

    // Build plain data for lines (memoized)
    const lineData = useMemo(() => buildDetailLineData(tool, maxWidth), [tool, maxWidth]);

    // Calculate visible range and update max scroll offset ref
    const totalLines = lineData.length;
    const maxScrollOffset = Math.max(0, totalLines - maxVisibleLines);
    maxScrollOffsetRef.current = maxScrollOffset;
    const clampedOffset = Math.min(scrollOffset, maxScrollOffset);

    // Calculate scroll indicators
    const hasMoreAbove = clampedOffset > 0;
    const hasMoreBelow = clampedOffset + maxVisibleLines < totalLines;

    return (
        <Box flexDirection="column" width={columns}>
            {/* Header */}
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Tool Details
                </Text>
                <Text color="gray"> - ↑↓ scroll, c copy schema, Esc back</Text>
                {copyFeedback && (
                    <Text color="green" bold>
                        {' '}
                        {copyFeedback}
                    </Text>
                )}
            </Box>

            {/* Separator */}
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">{'─'.repeat(Math.min(60, columns - 2))}</Text>
            </Box>

            {/* Scroll indicator - above (always present to avoid layout shift) */}
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">{hasMoreAbove ? `↑ ${clampedOffset} more above` : ' '}</Text>
            </Box>

            {/* Visible content - render directly from data like TextBufferInput */}
            {Array.from({ length: maxVisibleLines }, (_, i) => {
                const absoluteIndex = clampedOffset + i;
                const line = lineData[absoluteIndex];
                return (
                    <Box key={i} paddingX={0} paddingY={0}>
                        {line ? renderDetailLine(line, absoluteIndex) : <Text> </Text>}
                    </Box>
                );
            })}

            {/* Scroll indicator - below (always present to avoid layout shift) */}
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">
                    {hasMoreBelow
                        ? `↓ ${totalLines - clampedOffset - maxVisibleLines} more below`
                        : ' '}
                </Text>
            </Box>
        </Box>
    );
}

/**
 * Truncate text to max length with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
}

/**
 * Wrap text to fit within max width
 */
function wrapText(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;

    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        if (currentLine.length + word.length + 1 <= maxWidth) {
            currentLine += (currentLine ? ' ' : '') + word;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);

    return lines.join('\n');
}

export default ToolBrowser;
