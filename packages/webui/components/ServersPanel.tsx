import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { Button } from './ui/button';
import {
    X,
    ListChecks,
    RefreshCw,
    ChevronDown,
    Trash2,
    RotateCw,
    Plus,
    Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ServerRegistryEntry } from '@dexto/registry';
import type { McpServerConfig } from '@dexto/core';
import { serverRegistry } from '@/lib/serverRegistry';
import { buildConfigFromRegistryEntry, hasEmptyOrPlaceholderValue } from '@/lib/serverConfig';
import ServerRegistryModal from './ServerRegistryModal';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { useAnalytics } from '@/lib/analytics/index.js';
import { useServers, useAddServer, useDeleteServer, useRestartServer } from './hooks/useServers';
import { useAllTools, type ToolInfo } from './hooks/useTools';
import { useAgentPath } from './hooks/useAgents';

interface ServersPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenConnectModal: () => void;
    onOpenConnectWithPrefill?: (opts: {
        name: string;
        config: Partial<McpServerConfig> & { type?: 'stdio' | 'sse' | 'http' };
        lockName?: boolean;
        registryEntryId?: string;
        onCloseRegistryModal?: () => void;
    }) => void;
    onServerConnected?: (serverName: string) => void;
    variant?: 'overlay' | 'inline';
    refreshTrigger?: number; // Add a trigger to force refresh
}

// Utility function to strip MCP server prefix from tool names (mcp--serverName--toolName -> toolName)
function stripToolPrefix(toolName: string, source: 'internal' | 'custom' | 'mcp'): string {
    if (source !== 'mcp') {
        return toolName;
    }
    if (!toolName.startsWith('mcp--')) {
        return toolName;
    }
    const trimmed = toolName.substring('mcp--'.length);
    const parts = trimmed.split('--');
    return parts.length >= 2 ? parts.slice(1).join('--') : trimmed;
}

export default function ServersPanel({
    isOpen,
    onClose,
    onOpenConnectModal,
    onOpenConnectWithPrefill,
    onServerConnected,
    variant: variantProp,
    refreshTrigger,
}: ServersPanelProps) {
    const variant: 'overlay' | 'inline' = variantProp ?? 'overlay';
    const analytics = useAnalytics();

    const [isRegistryModalOpen, setIsRegistryModalOpen] = useState(false);
    const [isRegistryBusy, setIsRegistryBusy] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

    // Use TanStack Query hooks
    const {
        data: servers = [],
        isLoading: isLoadingServers,
        refetch: refetchServers,
    } = useServers(isOpen);

    const addServerMutation = useAddServer();
    const deleteServerMutation = useDeleteServer();
    const restartServerMutation = useRestartServer();

    // Fetch all tools from all sources (internal, custom, MCP)
    const {
        data: allToolsData,
        isLoading: isLoadingAllTools,
        refetch: refetchTools,
    } = useAllTools(isOpen);

    // Track agent path for auto-refresh on agent switch
    const { data: agentPath } = useAgentPath();

    // Unified refresh function
    const handleRefresh = useCallback(() => {
        refetchServers();
        refetchTools();
    }, [refetchServers, refetchTools]);

    // Toggle section collapse
    const toggleSection = useCallback((sectionTitle: string) => {
        setCollapsedSections((prev) => {
            const next = new Set(prev);
            if (next.has(sectionTitle)) {
                next.delete(sectionTitle);
            } else {
                next.add(sectionTitle);
            }
            return next;
        });
    }, []);

    // Group tools by source with server info
    const toolsBySource = useMemo(() => {
        if (!allToolsData)
            return {
                internal: [],
                custom: [],
                mcp: new Map<
                    string,
                    {
                        tools: ToolInfo[];
                        server: { id: string; name: string; status: string } | null;
                    }
                >(),
            };

        const internal: ToolInfo[] = [];
        const custom: ToolInfo[] = [];
        const mcp = new Map<
            string,
            { tools: ToolInfo[]; server: { id: string; name: string; status: string } | null }
        >();

        allToolsData.tools.forEach((tool: ToolInfo) => {
            if (tool.source === 'internal') {
                internal.push(tool);
            } else if (tool.source === 'custom') {
                custom.push(tool);
            } else if (tool.source === 'mcp' && tool.serverName) {
                const existing = mcp.get(tool.serverName) || { tools: [], server: null };
                existing.tools.push(tool);
                // Try to find the actual server
                if (!existing.server) {
                    const server = servers.find(
                        (s: { id: string; name: string }) => s.name === tool.serverName
                    );
                    existing.server = server || null;
                }
                mcp.set(tool.serverName, existing);
            }
        });

        return { internal, custom, mcp };
    }, [allToolsData, servers]);

    // Filter tools based on search query and create sections
    const filteredSections = useMemo(() => {
        const sections: Array<{
            title: string;
            tools: ToolInfo[];
            type: 'internal' | 'custom' | 'mcp';
            server?: { id: string; name: string; status: string } | null;
        }> = [];
        const query = searchQuery.toLowerCase();

        // Internal tools section
        if (toolsBySource.internal.length > 0) {
            const filtered = searchQuery
                ? toolsBySource.internal.filter(
                      (tool) =>
                          tool.name.toLowerCase().includes(query) ||
                          tool.description?.toLowerCase().includes(query)
                  )
                : toolsBySource.internal;

            if (filtered.length > 0) {
                sections.push({ title: 'Internal', tools: filtered, type: 'internal' });
            }
        }

        // Custom tools section
        if (toolsBySource.custom.length > 0) {
            const filtered = searchQuery
                ? toolsBySource.custom.filter(
                      (tool) =>
                          tool.name.toLowerCase().includes(query) ||
                          tool.description?.toLowerCase().includes(query)
                  )
                : toolsBySource.custom;

            if (filtered.length > 0) {
                sections.push({ title: 'Custom', tools: filtered, type: 'custom' });
            }
        }

        // MCP server sections
        toolsBySource.mcp.forEach(({ tools, server }, serverName) => {
            const serverMatches = serverName.toLowerCase().includes(query);
            const filtered = searchQuery
                ? serverMatches
                    ? tools
                    : tools.filter(
                          (tool) =>
                              tool.name.toLowerCase().includes(query) ||
                              tool.description?.toLowerCase().includes(query)
                      )
                : tools;

            if (filtered.length > 0) {
                sections.push({
                    title: serverName,
                    tools: filtered,
                    type: 'mcp',
                    server,
                });
            }
        });

        return sections;
    }, [toolsBySource, searchQuery]);

    // Calculate total tool count
    const totalToolCount = allToolsData?.totalCount || 0;

    const handleInstallServer = async (
        entry: ServerRegistryEntry
    ): Promise<'connected' | 'requires-input'> => {
        const config = buildConfigFromRegistryEntry(entry);

        const needsEnvInput =
            config.type === 'stdio' &&
            Object.keys(config.env || {}).length > 0 &&
            hasEmptyOrPlaceholderValue(config.env || {});
        const needsHeaderInput =
            (config.type === 'sse' || config.type === 'http') &&
            Object.keys(config.headers || {}).length > 0 &&
            hasEmptyOrPlaceholderValue(config.headers || {});

        // If additional input is needed, show the modal
        if (needsEnvInput || needsHeaderInput) {
            if (typeof onOpenConnectWithPrefill === 'function') {
                onOpenConnectWithPrefill({
                    name: entry.name,
                    config,
                    lockName: true,
                    registryEntryId: entry.id,
                    onCloseRegistryModal: () => setIsRegistryModalOpen(false),
                });
            }
            return 'requires-input';
        }

        // Otherwise, connect directly
        try {
            setIsRegistryBusy(true);
            await addServerMutation.mutateAsync({
                name: entry.name,
                config,
                persistToAgent: false,
            });

            // Sync registry after installation
            try {
                await serverRegistry.syncWithServerStatus();
            } catch (e) {
                console.warn('Failed to sync registry after server install:', e);
            }

            // Track MCP server connection
            analytics.trackMCPServerConnected({
                serverName: entry.name,
                transportType: config.type as 'stdio' | 'http' | 'sse',
            });

            setIsRegistryModalOpen(false);
            onServerConnected?.(entry.name);
            return 'connected';
        } catch (error: any) {
            throw new Error(error.message || 'Failed to install server');
        } finally {
            setIsRegistryBusy(false);
        }
    };

    const handleDeleteServer = async (serverId: string) => {
        const server = servers.find((s: { id: string; name: string }) => s.id === serverId);
        if (!server) return;

        if (!window.confirm(`Are you sure you want to remove server "${server.name}"?`)) {
            return;
        }

        try {
            await deleteServerMutation.mutateAsync(serverId);

            // Mark corresponding registry entry as uninstalled
            try {
                const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const currentId = normalize(serverId);
                const entries = await serverRegistry.getEntries();
                const match = entries.find((e) => {
                    const aliases = [e.id, e.name, ...(e.matchIds || [])]
                        .filter(Boolean)
                        .map((x) => normalize(String(x)));
                    return aliases.includes(currentId);
                });
                if (match) {
                    await serverRegistry.setInstalled(match.id, false);
                }
            } catch (e) {
                console.warn('Failed to update registry installed state on delete:', e);
            }

            // Sync registry with updated server status
            try {
                await serverRegistry.syncWithServerStatus();
            } catch (e) {
                console.warn('Failed to sync registry status after server deletion:', e);
            }
        } catch (err: any) {
            console.error('Delete server error:', err);
        }
    };

    const handleRestartServer = async (serverId: string) => {
        const server = servers.find((s: { id: string; name: string }) => s.id === serverId);
        if (!server) return;

        if (!window.confirm(`Restart server "${server.name}"?`)) {
            return;
        }

        try {
            await restartServerMutation.mutateAsync(serverId);

            // Sync registry with updated server status
            try {
                await serverRegistry.syncWithServerStatus();
            } catch (e) {
                console.warn('Failed to sync registry status after server restart:', e);
            }
        } catch (err: any) {
            console.error('Restart server error:', err);
        }
    };

    // Auto-refresh on panel open, agent switch, or external trigger
    // Consolidated from three separate useEffect hooks to prevent redundant fetches
    useEffect(() => {
        if (isOpen) {
            handleRefresh();
        }
    }, [isOpen, agentPath, refreshTrigger, handleRefresh]);

    // For inline variant, just return the content wrapped
    if (variant === 'inline') {
        return (
            <aside className="h-full w-full flex flex-col bg-card/30">
                {/* Panel Header */}
                <div className="flex items-center justify-between px-4 py-3.5 shrink-0 border-b border-border/30">
                    <button onClick={onClose} className="flex items-center gap-2 group">
                        <h2 className="text-xs font-bold text-foreground/80 tracking-wider uppercase group-hover:text-foreground transition-colors">
                            Tools & Servers
                        </h2>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 -rotate-90 transition-transform group-hover:text-foreground/70" />
                    </button>
                    <div className="flex items-center gap-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsRegistryModalOpen(true)}
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Connect MCP servers</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleRefresh}
                                    disabled={isLoadingServers || isLoadingAllTools}
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                >
                                    <RefreshCw
                                        className={cn(
                                            'h-4 w-4',
                                            (isLoadingServers || isLoadingAllTools) &&
                                                'animate-spin'
                                        )}
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Refresh</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {/* Content Area - Tools List */}
                <div className="flex-1 overflow-y-auto flex flex-col">
                    {/* Search Bar */}
                    <div className="px-4 pt-4 pb-3 border-b border-border/20">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search tools..."
                                className="w-full pl-9 pr-3 py-2 text-sm bg-background/50 border border-border/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted-foreground/40"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted/50 rounded transition-colors"
                                >
                                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tools List Container */}
                    <div className="flex-1 overflow-y-auto px-4 py-4">
                        {/* Loading State */}
                        {isLoadingAllTools && (
                            <div className="flex items-center justify-center py-16">
                                <div className="flex flex-col items-center space-y-3">
                                    <div className="relative">
                                        <div className="h-8 w-8 rounded-full border-2 border-primary/20" />
                                        <div className="absolute inset-0 h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                    </div>
                                    <span className="text-xs font-medium text-muted-foreground/70">
                                        Loading tools...
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* No Tools Available */}
                        {!isLoadingAllTools && totalToolCount === 0 && (
                            <div className="text-center py-16">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted/30 mb-4">
                                    <ListChecks className="h-6 w-6 text-muted-foreground/40" />
                                </div>
                                <p className="text-sm font-medium text-foreground/70 mb-1">
                                    No tools available
                                </p>
                                <p className="text-xs text-muted-foreground/60">
                                    Connect an MCP server to get started
                                </p>
                            </div>
                        )}

                        {/* No Search Results */}
                        {!isLoadingAllTools &&
                            totalToolCount > 0 &&
                            filteredSections.length === 0 && (
                                <div className="text-center py-16">
                                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted/30 mb-4">
                                        <Search className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                    <p className="text-sm font-medium text-foreground/70 mb-1">
                                        No tools match your search
                                    </p>
                                    <p className="text-xs text-muted-foreground/60 mb-3">
                                        Try a different search term
                                    </p>
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                                    >
                                        Clear search
                                    </button>
                                </div>
                            )}

                        {/* Tools Grouped by Source/Server */}
                        {filteredSections.map((section) => {
                            const isCollapsed = collapsedSections.has(section.title);
                            return (
                                <div key={section.title} className="mb-4 last:mb-0">
                                    {/* Section Header */}
                                    <div className="w-full flex items-center justify-between gap-2 mb-3 px-1 group transition-all duration-150">
                                        {/* Clickable collapse/expand area */}
                                        <button
                                            onClick={() => toggleSection(section.title)}
                                            className="flex items-center gap-2.5 flex-1 min-w-0 pb-2 border-b border-border/40 text-left"
                                        >
                                            <ChevronDown
                                                className={cn(
                                                    'h-4 w-4 text-muted-foreground/50 shrink-0 transition-transform duration-200',
                                                    isCollapsed && '-rotate-90'
                                                )}
                                            />
                                            <h4 className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2.5">
                                                <span className="tracking-normal">
                                                    {section.title}
                                                </span>
                                                {section.type === 'mcp' && (
                                                    <>
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
                                                            MCP
                                                        </span>
                                                        {section.server && (
                                                            <span
                                                                className={cn(
                                                                    'inline-flex items-center justify-center w-5 h-5 rounded-full',
                                                                    section.server.status ===
                                                                        'connected'
                                                                        ? 'bg-green-500/10'
                                                                        : 'bg-red-500/10'
                                                                )}
                                                            >
                                                                <span
                                                                    className={cn(
                                                                        'w-2 h-2 rounded-full',
                                                                        section.server.status ===
                                                                            'connected'
                                                                            ? 'bg-green-600 dark:bg-green-400'
                                                                            : 'bg-red-600 dark:bg-red-400'
                                                                    )}
                                                                />
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </h4>
                                            <span className="text-xs text-muted-foreground/50 font-medium">
                                                {section.tools.length}
                                            </span>
                                        </button>

                                        {/* MCP Server Controls - outside the collapse button */}
                                        {section.type === 'mcp' && section.server && (
                                            <div className="flex items-center gap-0.5">
                                                {/* Restart button */}
                                                {restartServerMutation.isPending &&
                                                restartServerMutation.variables ===
                                                    section.server.id ? (
                                                    <div className="h-6 w-6 flex items-center justify-center">
                                                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                                                    </div>
                                                ) : (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    handleRestartServer(
                                                                        section.server!.id
                                                                    )
                                                                }
                                                                className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-primary hover:bg-muted/50"
                                                                disabled={
                                                                    deleteServerMutation.isPending &&
                                                                    deleteServerMutation.variables ===
                                                                        section.server.id
                                                                }
                                                            >
                                                                <RotateCw className="h-3 w-3" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="left">
                                                            Restart
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}

                                                {/* Delete button */}
                                                {deleteServerMutation.isPending &&
                                                deleteServerMutation.variables ===
                                                    section.server.id ? (
                                                    <div className="h-6 w-6 flex items-center justify-center">
                                                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                                                    </div>
                                                ) : (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    handleDeleteServer(
                                                                        section.server!.id
                                                                    )
                                                                }
                                                                className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-destructive hover:bg-muted/50"
                                                                disabled={
                                                                    restartServerMutation.isPending &&
                                                                    restartServerMutation.variables ===
                                                                        section.server.id
                                                                }
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="left">
                                                            Remove
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Tool Items - Only show if not collapsed */}
                                    {!isCollapsed && (
                                        <div className="space-y-0.5 ml-2">
                                            {section.tools.map((tool) => {
                                                const toolId = tool.id;
                                                const isExpanded = expandedToolId === toolId;

                                                return (
                                                    <div key={toolId}>
                                                        <button
                                                            onClick={() =>
                                                                setExpandedToolId(
                                                                    isExpanded ? null : toolId
                                                                )
                                                            }
                                                            className="w-full px-3 py-2 rounded-md text-left hover:bg-muted/30 transition-all duration-150 group flex items-center justify-between gap-2"
                                                        >
                                                            <span className="text-sm text-foreground/90 truncate font-medium">
                                                                {stripToolPrefix(
                                                                    tool.name,
                                                                    section.type
                                                                )}
                                                            </span>
                                                            <ChevronDown
                                                                className={cn(
                                                                    'h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-transform duration-200',
                                                                    isExpanded && 'rotate-180'
                                                                )}
                                                            />
                                                        </button>

                                                        {/* Expanded Details */}
                                                        {isExpanded && (
                                                            <div className="px-3 py-2.5 mb-1 bg-muted/15 rounded-md ml-2">
                                                                {tool.description && (
                                                                    <p className="text-xs text-muted-foreground/70 mb-2.5 leading-relaxed">
                                                                        {tool.description}
                                                                    </p>
                                                                )}
                                                                {tool.inputSchema?.properties &&
                                                                    Object.keys(
                                                                        tool.inputSchema.properties
                                                                    ).length > 0 && (
                                                                        <div className="space-y-1.5">
                                                                            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-semibold">
                                                                                Parameters
                                                                            </p>
                                                                            <div className="flex flex-wrap gap-1.5">
                                                                                {Object.keys(
                                                                                    tool.inputSchema
                                                                                        .properties
                                                                                ).map((param) => (
                                                                                    <span
                                                                                        key={param}
                                                                                        className="inline-flex items-center px-2 py-0.5 rounded bg-muted/50 text-[10px] font-mono text-foreground/60 border border-border/20"
                                                                                    >
                                                                                        {param}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Server Registry Modal */}
                <ServerRegistryModal
                    isOpen={isRegistryModalOpen}
                    onClose={() => setIsRegistryModalOpen(false)}
                    onInstallServer={handleInstallServer}
                    onOpenConnectModal={onOpenConnectModal}
                    disableClose={isRegistryBusy}
                />
            </aside>
        );
    }

    // Overlay variant with slide animation
    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    'fixed inset-0 bg-black/50 z-30 transition-opacity duration-300',
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                onClick={onClose}
            />

            {/* Panel - slides from right */}
            <aside
                className={cn(
                    'fixed top-0 right-0 z-40 h-screen w-80 bg-card/95 backdrop-blur-xl border-l border-border/40 shadow-xl transition-transform duration-300 ease-in-out flex flex-col',
                    isOpen ? 'translate-x-0' : 'translate-x-full'
                )}
            >
                {/* Panel Header */}
                <div className="flex items-center justify-between px-4 py-3.5 shrink-0">
                    <h2 className="text-sm font-semibold text-foreground">Tools & Servers</h2>
                    <div className="flex items-center gap-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsRegistryModalOpen(true)}
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Connect MCP servers</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleRefresh}
                                    disabled={isLoadingServers || isLoadingAllTools}
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                >
                                    <RefreshCw
                                        className={cn(
                                            'h-4 w-4',
                                            (isLoadingServers || isLoadingAllTools) &&
                                                'animate-spin'
                                        )}
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Refresh</TooltipContent>
                        </Tooltip>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClose}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Content Area - Tools List */}
                <div className="flex-1 overflow-y-auto flex flex-col">
                    {/* Search Bar */}
                    <div className="px-4 pt-3 pb-2 border-b border-border/20">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search tools..."
                                className="w-full pl-9 pr-3 py-2 text-sm bg-background/50 border border-border/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all placeholder:text-muted-foreground/40"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted/50 rounded transition-colors"
                                >
                                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tools List Container */}
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                        {/* Loading State */}
                        {isLoadingAllTools && (
                            <div className="flex items-center justify-center py-12">
                                <div className="flex flex-col items-center space-y-2">
                                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/50" />
                                    <span className="text-xs text-muted-foreground/70">
                                        Loading tools...
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* No Tools Available */}
                        {!isLoadingAllTools && totalToolCount === 0 && (
                            <div className="text-center py-12">
                                <ListChecks className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                                <p className="text-xs text-muted-foreground/70">
                                    No tools available
                                </p>
                                <p className="text-xs text-muted-foreground/50 mt-1">
                                    Connect an MCP server to get started
                                </p>
                            </div>
                        )}

                        {/* No Search Results */}
                        {!isLoadingAllTools &&
                            totalToolCount > 0 &&
                            filteredSections.length === 0 && (
                                <div className="text-center py-12">
                                    <Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                                    <p className="text-xs text-muted-foreground/70">
                                        No tools match your search
                                    </p>
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
                                    >
                                        Clear search
                                    </button>
                                </div>
                            )}

                        {/* Tools Grouped by Source/Server */}
                        {filteredSections.map((section) => {
                            const isCollapsed = collapsedSections.has(section.title);
                            return (
                                <div key={section.title} className="mb-4 last:mb-0">
                                    {/* Section Header */}
                                    <div className="w-full flex items-center justify-between gap-2 mb-3 px-1 group transition-all duration-150">
                                        {/* Clickable collapse/expand area */}
                                        <button
                                            onClick={() => toggleSection(section.title)}
                                            className="flex items-center gap-2.5 flex-1 min-w-0 pb-2 border-b border-border/40 text-left"
                                        >
                                            <ChevronDown
                                                className={cn(
                                                    'h-4 w-4 text-muted-foreground/50 shrink-0 transition-transform duration-200',
                                                    isCollapsed && '-rotate-90'
                                                )}
                                            />
                                            <h4 className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2.5">
                                                <span className="tracking-normal">
                                                    {section.title}
                                                </span>
                                                {section.type === 'mcp' && (
                                                    <>
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
                                                            MCP
                                                        </span>
                                                        {section.server && (
                                                            <span
                                                                className={cn(
                                                                    'inline-flex items-center justify-center w-5 h-5 rounded-full',
                                                                    section.server.status ===
                                                                        'connected'
                                                                        ? 'bg-green-500/10'
                                                                        : 'bg-red-500/10'
                                                                )}
                                                            >
                                                                <span
                                                                    className={cn(
                                                                        'w-2 h-2 rounded-full',
                                                                        section.server.status ===
                                                                            'connected'
                                                                            ? 'bg-green-600 dark:bg-green-400'
                                                                            : 'bg-red-600 dark:bg-red-400'
                                                                    )}
                                                                />
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </h4>
                                            <span className="text-xs text-muted-foreground/50 font-medium">
                                                {section.tools.length}
                                            </span>
                                        </button>

                                        {/* MCP Server Controls - outside the collapse button */}
                                        {section.type === 'mcp' && section.server && (
                                            <div className="flex items-center gap-0.5">
                                                {/* Restart button */}
                                                {restartServerMutation.isPending &&
                                                restartServerMutation.variables ===
                                                    section.server.id ? (
                                                    <div className="h-6 w-6 flex items-center justify-center">
                                                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                                                    </div>
                                                ) : (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    handleRestartServer(
                                                                        section.server!.id
                                                                    )
                                                                }
                                                                className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-primary hover:bg-muted/50"
                                                                disabled={
                                                                    deleteServerMutation.isPending &&
                                                                    deleteServerMutation.variables ===
                                                                        section.server.id
                                                                }
                                                            >
                                                                <RotateCw className="h-3 w-3" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="left">
                                                            Restart
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}

                                                {/* Delete button */}
                                                {deleteServerMutation.isPending &&
                                                deleteServerMutation.variables ===
                                                    section.server.id ? (
                                                    <div className="h-6 w-6 flex items-center justify-center">
                                                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                                                    </div>
                                                ) : (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    handleDeleteServer(
                                                                        section.server!.id
                                                                    )
                                                                }
                                                                className="h-6 w-6 p-0 text-muted-foreground/60 hover:text-destructive hover:bg-muted/50"
                                                                disabled={
                                                                    restartServerMutation.isPending &&
                                                                    restartServerMutation.variables ===
                                                                        section.server.id
                                                                }
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="left">
                                                            Remove
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Tool Items - Only show if not collapsed */}
                                    {!isCollapsed && (
                                        <div className="space-y-0.5 ml-2">
                                            {section.tools.map((tool) => {
                                                const toolId = tool.id;
                                                const isExpanded = expandedToolId === toolId;

                                                return (
                                                    <div key={toolId}>
                                                        <button
                                                            onClick={() =>
                                                                setExpandedToolId(
                                                                    isExpanded ? null : toolId
                                                                )
                                                            }
                                                            className="w-full px-3 py-2 rounded-md text-left hover:bg-muted/30 transition-all duration-150 group flex items-center justify-between gap-2"
                                                        >
                                                            <span className="text-sm text-foreground/90 truncate font-medium">
                                                                {stripToolPrefix(
                                                                    tool.name,
                                                                    section.type
                                                                )}
                                                            </span>
                                                            <ChevronDown
                                                                className={cn(
                                                                    'h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-transform duration-200',
                                                                    isExpanded && 'rotate-180'
                                                                )}
                                                            />
                                                        </button>

                                                        {/* Expanded Details */}
                                                        {isExpanded && (
                                                            <div className="px-3 py-2.5 mb-1 bg-muted/15 rounded-md ml-2">
                                                                {tool.description && (
                                                                    <p className="text-xs text-muted-foreground/70 mb-2.5 leading-relaxed">
                                                                        {tool.description}
                                                                    </p>
                                                                )}
                                                                {tool.inputSchema?.properties &&
                                                                    Object.keys(
                                                                        tool.inputSchema.properties
                                                                    ).length > 0 && (
                                                                        <div className="space-y-1.5">
                                                                            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-semibold">
                                                                                Parameters
                                                                            </p>
                                                                            <div className="flex flex-wrap gap-1.5">
                                                                                {Object.keys(
                                                                                    tool.inputSchema
                                                                                        .properties
                                                                                ).map((param) => (
                                                                                    <span
                                                                                        key={param}
                                                                                        className="inline-flex items-center px-2 py-0.5 rounded bg-muted/50 text-[10px] font-mono text-foreground/60 border border-border/20"
                                                                                    >
                                                                                        {param}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Server Registry Modal */}
                <ServerRegistryModal
                    isOpen={isRegistryModalOpen}
                    onClose={() => setIsRegistryModalOpen(false)}
                    onInstallServer={handleInstallServer}
                    onOpenConnectModal={onOpenConnectModal}
                    disableClose={isRegistryBusy}
                />
            </aside>
        </>
    );
}
