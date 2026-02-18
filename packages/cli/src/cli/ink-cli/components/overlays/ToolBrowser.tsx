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
import { getMaxVisibleItemsForTerminalRows } from '../../utils/overlaySizing.js';
import { HintBar } from '../shared/HintBar.js';

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

const LIST_ACTIONS: ListAction[] = ['view', 'config', 'back'];

/**
 * Tool browser with search and detail views
 */
const ToolBrowser = forwardRef<ToolBrowserHandle, ToolBrowserProps>(function ToolBrowser(
    { isVisible, onClose, agent, sessionId },
    ref
) {
    const { columns, rows } = useTerminalSize();
    const maxVisibleTools = useMemo(() => {
        return getMaxVisibleItemsForTerminalRows({
            rows,
            hardCap: 10,
            reservedRows: 16,
        });
    }, [rows]);
    const [tools, setTools] = useState<ToolInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selection, setSelection] = useState({ index: 0, offset: 0 });
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
    const [detailScrollOffset, setDetailScrollOffset] = useState(0);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [listActionsIndex, setListActionsIndex] = useState(0);
    const [configIndex, setConfigIndex] = useState(0);
    const [scopeToolName, setScopeToolName] = useState<string | null>(null);
    const [scopeNextEnabled, setScopeNextEnabled] = useState<boolean>(true);
    const [scopeTarget, setScopeTarget] = useState<'session' | 'global'>('session');
    const selectedIndexRef = useRef(0);
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
    selectedIndexRef.current = selection.index;
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
        setSelection({ index: 0, offset: 0 });
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

    // Keep selection valid and visible when filtering or terminal height changes.
    useEffect(() => {
        setSelection((prev) => {
            const maxIndex = Math.max(0, filteredTools.length - 1);
            const nextIndex = Math.min(prev.index, maxIndex);

            let nextOffset = prev.offset;
            if (nextIndex < nextOffset) {
                nextOffset = nextIndex;
            } else if (nextIndex >= nextOffset + maxVisibleTools) {
                nextOffset = Math.max(0, nextIndex - maxVisibleTools + 1);
            }

            const maxOffset = Math.max(0, filteredTools.length - maxVisibleTools);
            nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));

            if (nextIndex === prev.index && nextOffset === prev.offset) {
                return prev;
            }

            selectedIndexRef.current = nextIndex;
            return { index: nextIndex, offset: nextOffset };
        });
    }, [filteredTools.length, maxVisibleTools]);

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

                if (isLoading) {
                    if (key.escape) {
                        onClose();
                    }
                    return true;
                }

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
                        selectedIndexRef.current = 0;
                        setSelection({ index: 0, offset: 0 });
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
                    selectedIndexRef.current = nextIndex;
                    setSelection((prev) => {
                        let nextOffset = prev.offset;
                        if (nextIndex < prev.offset) {
                            nextOffset = nextIndex;
                        } else if (nextIndex >= prev.offset + maxVisibleTools) {
                            nextOffset = Math.max(0, nextIndex - maxVisibleTools + 1);
                        }
                        const maxOffset = Math.max(0, itemsLength - maxVisibleTools);
                        nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));
                        return { index: nextIndex, offset: nextOffset };
                    });
                    return true;
                }

                if (key.downArrow) {
                    const nextIndex = (selectedIndexRef.current + 1) % itemsLength;
                    selectedIndexRef.current = nextIndex;
                    setSelection((prev) => {
                        let nextOffset = prev.offset;
                        if (nextIndex < prev.offset) {
                            nextOffset = nextIndex;
                        } else if (nextIndex >= prev.offset + maxVisibleTools) {
                            nextOffset = Math.max(0, nextIndex - maxVisibleTools + 1);
                        }
                        const maxOffset = Math.max(0, itemsLength - maxVisibleTools);
                        nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));
                        return { index: nextIndex, offset: nextOffset };
                    });
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
        [isVisible, isLoading, filteredTools, maxVisibleTools, onClose, sessionId]
    );

    if (!isVisible) return null;

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
    const selectedIndex = selection.index;
    const scrollOffset = selection.offset;
    const visibleTools = filteredTools.slice(scrollOffset, scrollOffset + maxVisibleTools);
    const filteredLocalCount = filteredTools.filter((t) => t.source === 'local').length;
    const filteredMcpCount = filteredTools.filter((t) => t.source === 'mcp').length;
    const selectedToolInList = filteredTools[selectedIndex];

    let detailLine = '';
    if (isLoading) {
        detailLine = 'Loading tools…';
    } else if (loadError) {
        detailLine = loadError;
    } else if (searchQuery.trim() && filteredTools.length === 0) {
        detailLine = 'No tools match your search';
    } else if (selectedToolInList) {
        detailLine = selectedToolInList.description;
    }

    return (
        <Box flexDirection="column" width={columns}>
            {/* Header */}
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Tools
                </Text>
                <Text color="gray">
                    {' '}
                    ({filteredTools.length} tools: {filteredLocalCount} local, {filteredMcpCount}{' '}
                    MCP)
                </Text>
            </Box>

            {/* Search input */}
            <Box paddingX={0} paddingY={0} marginTop={1}>
                <Text color="gray">Search: </Text>
                <Text color={searchQuery ? 'white' : 'gray'} wrap="truncate-end">
                    {searchQuery || 'Type to filter tools…'}
                </Text>
            </Box>

            {/* Tools list */}
            <Box flexDirection="column" height={maxVisibleTools} marginTop={1}>
                {isLoading || filteredTools.length === 0
                    ? Array.from({ length: maxVisibleTools }, (_, index) => (
                          <Box key={`tool-empty-${index}`} paddingX={0} paddingY={0}>
                              <Text> </Text>
                          </Box>
                      ))
                    : Array.from({ length: maxVisibleTools }, (_, rowIndex) => {
                          const tool = visibleTools[rowIndex];
                          if (!tool) {
                              return (
                                  <Box key={`tool-empty-${rowIndex}`} paddingX={0} paddingY={0}>
                                      <Text> </Text>
                                  </Box>
                              );
                          }

                          const actualIndex = scrollOffset + rowIndex;
                          const isSelected = actualIndex === selectedIndex;
                          const prefix = `${isSelected ? '›' : ' '} ${tool.isEnabled ? '✓' : '×'} ${
                              tool.source === 'local' ? 'L' : 'M'
                          } ${tool.isAutoApproved ? '⚡' : ' '}`;

                          return (
                              <Box key={tool.name} paddingX={0} paddingY={0}>
                                  <Text
                                      color={isSelected ? 'cyan' : 'gray'}
                                      bold={isSelected}
                                      wrap="truncate-end"
                                  >
                                      {prefix} {tool.name}
                                  </Text>
                              </Box>
                          );
                      })}
            </Box>

            <Box paddingX={0} paddingY={0} marginTop={1}>
                <Text color={loadError ? 'red' : 'gray'} wrap="truncate-end">
                    {detailLine}
                </Text>
            </Box>

            <Box paddingX={0} paddingY={0}>
                <HintBar hints={['↑↓ navigate', 'Enter options', 'Esc close']} />
            </Box>
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
