/**
 * ToolBrowser Component
 * Interactive browser for exploring available tools
 * Features:
 * - Search/filter tools by name
 * - View tool details (description, schema)
 * - Shows source (MCP server or Local)
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
    sessionId: string | null;
}

export interface ToolBrowserHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ToolInfo {
    name: string;
    description: string;
    source: 'local' | 'mcp';
    serverName: string | undefined;
    inputSchema: Record<string, unknown> | undefined;
    isEnabled: boolean;
    isAutoApproved: boolean;
}

type ViewMode = 'list' | 'list-actions' | 'detail' | 'config' | 'scope';

type ListAction = 'view' | 'config' | 'back';

const MAX_VISIBLE_ITEMS = 12;
const LIST_ACTIONS: ListAction[] = ['view', 'config', 'back'];

/**
 * Tool browser with search and detail views
 */
const ToolBrowser = forwardRef<ToolBrowserHandle, ToolBrowserProps>(function ToolBrowser(
    { isVisible, onClose, agent, sessionId },
    ref
) {
    const { columns, rows } = useTerminalSize();
    const maxVisibleItems = useMemo(() => {
        // Keep overlay height responsive to terminal size to reduce flicker/jitter
        // when overlays get taller than the available viewport.
        return Math.max(4, Math.min(MAX_VISIBLE_ITEMS, rows - 10));
    }, [rows]);
    const [tools, setTools] = useState<ToolInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [scrollOffset, setScrollOffset] = useState(0);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
    const [detailScrollOffset, setDetailScrollOffset] = useState(0);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [listActionsIndex, setListActionsIndex] = useState(0);
    const [configIndex, setConfigIndex] = useState(0);
    const [scopeToolName, setScopeToolName] = useState<string | null>(null);
    const [scopeNextEnabled, setScopeNextEnabled] = useState<boolean>(true);
    const [scopeTarget, setScopeTarget] = useState<'session' | 'global'>('session');
    const selectedIndexRef = useRef(selectedIndex);
    const viewModeRef = useRef(viewMode);
    const detailScrollOffsetRef = useRef(detailScrollOffset);
    const detailMaxScrollOffsetRef = useRef(0);
    const selectedToolRef = useRef<ToolInfo | null>(null);
    const toolsRef = useRef<ToolInfo[]>([]);
    const listActionsIndexRef = useRef(listActionsIndex);
    const configIndexRef = useRef(configIndex);
    const scopeTargetRef = useRef(scopeTarget);
    const scopeNextEnabledRef = useRef(scopeNextEnabled);
    const scopeToolNameRef = useRef(scopeToolName);

    // Keep refs in sync
    selectedIndexRef.current = selectedIndex;
    viewModeRef.current = viewMode;
    detailScrollOffsetRef.current = detailScrollOffset;
    selectedToolRef.current = selectedTool;
    toolsRef.current = tools;
    listActionsIndexRef.current = listActionsIndex;
    configIndexRef.current = configIndex;
    scopeTargetRef.current = scopeTarget;
    scopeNextEnabledRef.current = scopeNextEnabled;
    scopeToolNameRef.current = scopeToolName;

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
        setListActionsIndex(0);
        setConfigIndex(0);
        setLoadError(null);

        const fetchTools = async () => {
            try {
                const [allTools, mcpTools, enabledTools, autoApprovedTools] = await Promise.all([
                    agent.getAllTools(),
                    agent.getAllMcpTools(),
                    agent.getEnabledTools(sessionId || undefined),
                    sessionId ? agent.getSessionAutoApproveTools(sessionId) : Promise.resolve([]),
                ]);

                const toolList: ToolInfo[] = [];
                const mcpToolNames = new Set(Object.keys(mcpTools));
                const enabledToolNames = new Set(Object.keys(enabledTools));
                const autoApprovedToolNames = new Set(autoApprovedTools ?? []);

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
                        source: isMcpTool ? 'mcp' : 'local',
                        serverName,
                        inputSchema: toolInfo.parameters as Record<string, unknown> | undefined,
                        isEnabled: enabledToolNames.has(toolName),
                        isAutoApproved: autoApprovedToolNames.has(toolName),
                    });
                }

                // Sort: local tools first, then MCP tools
                toolList.sort((a, b) => {
                    if (a.source !== b.source) {
                        return a.source === 'local' ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                });

                if (!cancelled) {
                    setTools(toolList);
                    setIsLoading(false);
                    setLoadError(null);
                }
            } catch (error) {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : 'Unknown error';
                    setTools([]);
                    setIsLoading(false);
                    setLoadError(`Failed to load tools: ${message}`);
                }
            }
        };

        void fetchTools();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent, sessionId]);

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
        } else if (selectedIndex >= scrollOffset + maxVisibleItems) {
            setScrollOffset(selectedIndex - maxVisibleItems + 1);
        }
    }, [selectedIndex, scrollOffset, maxVisibleItems]);

    const openListActions = (tool: ToolInfo) => {
        setSelectedTool(tool);
        setListActionsIndex(0);
        setViewMode('list-actions');
    };

    const openToolDetails = (tool: ToolInfo) => {
        setSelectedTool(tool);
        setViewMode('detail');
        setDetailScrollOffset(0);
    };

    const openConfigMenu = (tool: ToolInfo) => {
        setSelectedTool(tool);
        setConfigIndex(0);
        setViewMode('config');
    };

    const openScopePrompt = (tool: ToolInfo) => {
        const nextEnabled = !tool.isEnabled;
        const nextScope = sessionId ? 'session' : 'global';

        setSelectedTool(tool);
        setScopeToolName(tool.name);
        setScopeNextEnabled(nextEnabled);
        setScopeTarget(nextScope);
        setViewMode('scope');

        scopeToolNameRef.current = tool.name;
        scopeNextEnabledRef.current = nextEnabled;
        scopeTargetRef.current = nextScope;
    };

    const closeScopePrompt = () => {
        setViewMode('config');
        setScopeToolName(null);
    };

    const applyToolToggle = async (overrideTarget?: 'session' | 'global') => {
        const targetToolName =
            scopeToolNameRef.current ?? scopeToolName ?? selectedToolRef.current?.name;
        if (!targetToolName) return;

        const effectiveTarget = overrideTarget ?? scopeTargetRef.current;
        const nextEnabled = scopeNextEnabledRef.current;

        const previousTools = toolsRef.current;
        const updatedTools = previousTools.map((tool) => {
            if (tool.name !== targetToolName) {
                return tool;
            }

            const updatedTool = { ...tool, isEnabled: nextEnabled };
            if (!nextEnabled && tool.isAutoApproved) {
                updatedTool.isAutoApproved = false;
            }

            return updatedTool;
        });

        setTools(updatedTools);
        const updatedSelected = updatedTools.find((tool) => tool.name === targetToolName) ?? null;
        setSelectedTool(updatedSelected);

        const autoApprovedTools = updatedTools
            .filter((tool) => tool.isAutoApproved)
            .map((tool) => tool.name);

        if (sessionId) {
            agent.setSessionAutoApproveTools(sessionId, autoApprovedTools);
        }

        const disabledTools = updatedTools
            .filter((tool) => !tool.isEnabled)
            .map((tool) => tool.name);

        if (effectiveTarget === 'session' && sessionId) {
            agent.setSessionDisabledTools(sessionId, disabledTools);
        } else if (effectiveTarget === 'global') {
            try {
                const { updateAgentPreferences, saveAgentPreferences, agentPreferencesExist } =
                    await import('@dexto/agent-management');

                if (agentPreferencesExist(agent.config.agentId)) {
                    await updateAgentPreferences(agent.config.agentId, {
                        tools: { disabled: disabledTools },
                    });
                } else {
                    await saveAgentPreferences(agent.config.agentId, {
                        tools: { disabled: disabledTools },
                    });
                }

                agent.setGlobalDisabledTools(disabledTools);
            } catch (_error) {
                // If we can't persist, still keep session state so user sees effect
                if (sessionId) {
                    agent.setSessionDisabledTools(sessionId, disabledTools);
                } else {
                    setTools(previousTools);
                    setSelectedTool(
                        previousTools.find((tool) => tool.name === targetToolName) ?? null
                    );
                }
            }
        }

        closeScopePrompt();
    };

    const toggleAutoApprove = () => {
        if (!sessionId) return;

        const updatedTools = toolsRef.current.map((tool) =>
            tool.name === selectedToolRef.current?.name
                ? { ...tool, isAutoApproved: !tool.isAutoApproved }
                : tool
        );

        const updatedSelected = updatedTools.find(
            (tool) => tool.name === selectedToolRef.current?.name
        );

        setTools(updatedTools);
        setSelectedTool(updatedSelected ?? null);

        const autoApprovedTools = updatedTools
            .filter((tool) => tool.isAutoApproved)
            .map((tool) => tool.name);

        agent.setSessionAutoApproveTools(sessionId, autoApprovedTools);
    };

    const closeConfigMenu = () => {
        setViewMode('list-actions');
    };

    const closeDetailView = () => {
        setViewMode('list-actions');
    };

    const closeListActions = () => {
        setViewMode('list');
        setSelectedTool(null);
    };

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Scope selection view
                if (viewModeRef.current === 'scope') {
                    if (key.escape || key.backspace || key.delete) {
                        closeScopePrompt();
                        return true;
                    }
                    if (key.upArrow || key.downArrow) {
                        setScopeTarget((prev) => (prev === 'session' ? 'global' : 'session'));
                        return true;
                    }
                    if (key.return) {
                        if (scopeTargetRef.current === 'session' && !sessionId) {
                            setScopeTarget('global');
                            scopeTargetRef.current = 'global';
                            void applyToolToggle('global');
                            return true;
                        }
                        void applyToolToggle();
                        return true;
                    }
                    return true;
                }

                // Config menu view
                if (viewModeRef.current === 'config') {
                    if (key.escape || key.backspace || key.delete) {
                        closeConfigMenu();
                        return true;
                    }
                    if (key.upArrow) {
                        const nextIndex = (configIndexRef.current - 1 + 3) % 3;
                        setConfigIndex(nextIndex);
                        return true;
                    }
                    if (key.downArrow) {
                        const nextIndex = (configIndexRef.current + 1) % 3;
                        setConfigIndex(nextIndex);
                        return true;
                    }
                    if (key.return) {
                        const tool = selectedToolRef.current;
                        if (tool) {
                            if (configIndexRef.current === 0) {
                                openScopePrompt(tool);
                            } else if (configIndexRef.current === 1) {
                                if (sessionId && tool.isEnabled) {
                                    toggleAutoApprove();
                                }
                            } else {
                                closeConfigMenu();
                            }
                        }
                        return true;
                    }
                    return true;
                }

                // Detail view
                if (viewModeRef.current === 'detail') {
                    if (key.escape || key.backspace || key.delete) {
                        closeDetailView();
                        return true;
                    }

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
                    if (key.return) {
                        const tool = selectedToolRef.current;
                        if (tool) {
                            openConfigMenu(tool);
                        }
                        return true;
                    }
                    return true;
                }

                // List action menu view
                if (viewModeRef.current === 'list-actions') {
                    if (key.escape || key.backspace || key.delete) {
                        closeListActions();
                        return true;
                    }
                    if (key.upArrow) {
                        const nextIndex =
                            (listActionsIndexRef.current - 1 + LIST_ACTIONS.length) %
                            LIST_ACTIONS.length;
                        setListActionsIndex(nextIndex);
                        return true;
                    }
                    if (key.downArrow) {
                        const nextIndex = (listActionsIndexRef.current + 1) % LIST_ACTIONS.length;
                        setListActionsIndex(nextIndex);
                        return true;
                    }
                    if (key.return) {
                        const tool = selectedToolRef.current;
                        const action = LIST_ACTIONS[listActionsIndexRef.current];
                        if (!tool) {
                            closeListActions();
                            return true;
                        }
                        if (action === 'view') {
                            openToolDetails(tool);
                        } else if (action === 'config') {
                            openConfigMenu(tool);
                        } else {
                            closeListActions();
                        }
                        return true;
                    }
                    return true;
                }

                // In list view
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
                        openListActions(tool);
                        return true;
                    }
                }

                return false;
            },
        }),
        [isVisible, filteredTools, onClose, sessionId]
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">Loading tools...</Text>
            </Box>
        );
    }

    if (viewMode === 'list-actions' && selectedTool) {
        return (
            <ToolActionsMenu
                tool={selectedTool}
                columns={columns}
                listActionsIndex={listActionsIndex}
            />
        );
    }

    if (viewMode === 'detail' && selectedTool) {
        const maxVisibleLines = Math.min(18, Math.max(5, rows - 6));
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

    if (viewMode === 'config' && selectedTool) {
        return (
            <ToolSettingsView
                tool={selectedTool}
                columns={columns}
                configIndex={configIndex}
                sessionAvailable={Boolean(sessionId)}
            />
        );
    }

    if (viewMode === 'scope' && selectedTool) {
        return (
            <ToolScopeView
                tool={selectedTool}
                columns={columns}
                scopeTarget={scopeTarget}
                scopeNextEnabled={scopeNextEnabled}
                sessionAvailable={Boolean(sessionId)}
            />
        );
    }

    // List view
    const visibleTools = filteredTools.slice(scrollOffset, scrollOffset + maxVisibleItems);
    const filteredLocalCount = filteredTools.filter((t) => t.source === 'local').length;
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
                    ({filteredTools.length} tools: {filteredLocalCount} local, {filteredMcpCount}{' '}
                    MCP)
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">↑↓ navigate · Enter options · Esc close</Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">Type to search · Backspace to delete</Text>
            </Box>
            {loadError && (
                <Box paddingX={0} paddingY={0}>
                    <Text color="red">{loadError}</Text>
                </Box>
            )}

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
                            <Text color={tool.source === 'local' ? 'magenta' : 'blue'}>
                                {' '}
                                [{tool.source === 'local' ? 'Local' : 'MCP'}]
                            </Text>
                            {tool.serverName && <Text color="gray"> ({tool.serverName})</Text>}
                            <Text color={tool.isEnabled ? 'green' : 'red'}>
                                {' '}
                                {tool.isEnabled ? 'Enabled' : 'Disabled'}
                            </Text>
                            {tool.isAutoApproved && <Text color="yellow"> [auto-approved]</Text>}
                        </Box>
                    );
                })
            )}

            {/* Scroll indicator */}
            {filteredTools.length > maxVisibleItems && (
                <Box paddingX={0} paddingY={0} marginTop={1}>
                    <Text color="gray">
                        {scrollOffset > 0 ? '↑ more above' : ''}
                        {scrollOffset > 0 && scrollOffset + maxVisibleItems < filteredTools.length
                            ? ' | '
                            : ''}
                        {scrollOffset + maxVisibleItems < filteredTools.length
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
    | { type: 'source'; source: 'local' | 'mcp'; serverName: string | undefined }
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
                    const descLines = wrapText(description, maxWidth - 2).split('\n');
                    for (const descLine of descLines) {
                        lines.push({ type: 'param-desc', text: descLine });
                    }
                }

                // Enum values
                if (enumValues && enumValues.length > 0) {
                    lines.push({ type: 'param-enum', values: enumValues });
                }
            }
        }
    }

    return lines;
}

/**
 * Render a detail line based on type
 */
function renderDetailLine(line: DetailLineType, _index: number): React.ReactElement {
    switch (line.type) {
        case 'title':
            return (
                <Text color="cyan" bold>
                    {line.text}
                </Text>
            );
        case 'source':
            return (
                <Text color={line.source === 'local' ? 'magenta' : 'blue'}>
                    {line.source === 'local' ? 'Local Tool' : 'MCP Tool'}
                    {line.serverName ? ` (${line.serverName})` : ''}
                </Text>
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

function ToolActionsMenu({
    tool,
    columns,
    listActionsIndex,
}: {
    tool: ToolInfo;
    columns: number;
    listActionsIndex: number;
}) {
    return (
        <Box flexDirection="column" width={columns}>
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Tool Options
                </Text>
                <Text color="gray"> {tool.name}</Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color={listActionsIndex === 0 ? 'cyan' : 'gray'}>
                    {listActionsIndex === 0 ? '▶ ' : '  '}View details
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color={listActionsIndex === 1 ? 'cyan' : 'gray'}>
                    {listActionsIndex === 1 ? '▶ ' : '  '}Edit tool settings
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color={listActionsIndex === 2 ? 'cyan' : 'gray'}>
                    {listActionsIndex === 2 ? '▶ ' : '  '}Back
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">↑↓ select · Enter confirm · Esc back</Text>
            </Box>
        </Box>
    );
}

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
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Tool Details
                </Text>
                <Text color="gray"> - ↑↓ scroll, c copy schema, Enter settings, Esc back</Text>
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

function ToolSettingsView({
    tool,
    columns,
    configIndex,
    sessionAvailable,
}: {
    tool: ToolInfo;
    columns: number;
    configIndex: number;
    sessionAvailable: boolean;
}) {
    const autoApproveDisabled = !tool.isEnabled;
    const autoApproveUnavailable = !sessionAvailable || autoApproveDisabled;

    return (
        <Box flexDirection="column" width={columns}>
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Tool Settings
                </Text>
                <Text color="gray"> {tool.name}</Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">Status: </Text>
                <Text color={tool.isEnabled ? 'green' : 'red'}>
                    {tool.isEnabled ? 'Enabled' : 'Disabled'}
                </Text>
                <Text color="gray"> · Auto-approve: </Text>
                <Text color={tool.isAutoApproved ? 'green' : 'red'}>
                    {tool.isAutoApproved ? 'On' : 'Off'}
                </Text>
                <Text color="gray"> (session)</Text>
            </Box>
            {autoApproveDisabled && (
                <Box paddingX={0} paddingY={0}>
                    <Text color="yellow">Enable the tool to allow auto-approve.</Text>
                </Box>
            )}
            <Box paddingX={0} paddingY={0}>
                <Text color={configIndex === 0 ? 'cyan' : 'gray'}>
                    {configIndex === 0 ? '▶ ' : '  '}
                    {tool.isEnabled ? 'Disable tool' : 'Enable tool'}
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text
                    color={
                        configIndex === 1 ? (autoApproveUnavailable ? 'yellow' : 'cyan') : 'gray'
                    }
                >
                    {configIndex === 1 ? '▶ ' : '  '}
                    {tool.isAutoApproved
                        ? 'Disable auto-approve (session)'
                        : 'Enable auto-approve (session)'}
                </Text>
            </Box>
            {!sessionAvailable && (
                <Box paddingX={0} paddingY={0}>
                    <Text color="yellow">Auto-approve requires an active session.</Text>
                </Box>
            )}
            <Box paddingX={0} paddingY={0}>
                <Text color={configIndex === 2 ? 'cyan' : 'gray'}>
                    {configIndex === 2 ? '▶ ' : '  '}Back
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">↑↓ select · Enter confirm · Esc back</Text>
            </Box>
        </Box>
    );
}

function ToolScopeView({
    tool,
    columns,
    scopeTarget,
    scopeNextEnabled,
    sessionAvailable,
}: {
    tool: ToolInfo;
    columns: number;
    scopeTarget: 'session' | 'global';
    scopeNextEnabled: boolean;
    sessionAvailable: boolean;
}) {
    return (
        <Box flexDirection="column" width={columns}>
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    {scopeNextEnabled ? 'Enable Tool' : 'Disable Tool'}
                </Text>
                <Text color="gray"> {tool.name}</Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">Apply to:</Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color={scopeTarget === 'session' ? 'cyan' : 'gray'}>
                    {scopeTarget === 'session' ? '▶ ' : '  '}Session (default)
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0}>
                <Text color={scopeTarget === 'global' ? 'cyan' : 'gray'}>
                    {scopeTarget === 'global' ? '▶ ' : '  '}Global (persisted)
                </Text>
            </Box>
            {!sessionAvailable && scopeTarget === 'session' && (
                <Box paddingX={0} paddingY={0}>
                    <Text color="yellow">No active session; switching to global.</Text>
                </Box>
            )}
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">↑↓ choose scope · Enter confirm · Esc back</Text>
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
