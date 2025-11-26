'use client';

import React, { useState, useEffect } from 'react';

import { Button } from './ui/button';
import {
    X,
    Server,
    ListChecks,
    RefreshCw,
    AlertTriangle,
    ChevronDown,
    Trash2,
    Package,
    RotateCw,
    FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ServerRegistryEntry } from '@/types';
import type { McpServerConfig } from '@dexto/core';
import { serverRegistry } from '@/lib/serverRegistry';
import { buildConfigFromRegistryEntry, hasEmptyOrPlaceholderValue } from '@/lib/serverConfig';
import ServerRegistryModal from './ServerRegistryModal';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { useAnalytics } from '@/lib/analytics/index.js';
import {
    useServers,
    useServerTools,
    useAddServer,
    useDeleteServer,
    useRestartServer,
} from './hooks/useServers';

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

    const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
    const [isToolsExpanded, setIsToolsExpanded] = useState(false);
    const [isRegistryModalOpen, setIsRegistryModalOpen] = useState(false);
    const [isRegistryBusy, setIsRegistryBusy] = useState(false);

    // Use TanStack Query hooks
    const {
        data: servers = [],
        isLoading: isLoadingServers,
        error: serverError,
        refetch: refetchServers,
    } = useServers(isOpen);

    const {
        data: tools = [],
        isLoading: isLoadingTools,
        error: toolsError,
    } = useServerTools(selectedServerId, isOpen && !!selectedServerId);

    const addServerMutation = useAddServer();
    const deleteServerMutation = useDeleteServer();
    const restartServerMutation = useRestartServer();

    // Auto-select first connected server when servers load
    useEffect(() => {
        if (servers.length > 0 && !selectedServerId) {
            const firstConnected = servers.find((s) => s.status === 'connected');
            setSelectedServerId(firstConnected?.id || servers[0].id);
        }
    }, [servers, selectedServerId]);

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
        const server = servers.find((s) => s.id === serverId);
        if (!server) return;

        if (!window.confirm(`Are you sure you want to remove server "${server.name}"?`)) {
            return;
        }

        try {
            // If this was the selected server, deselect it
            if (selectedServerId === serverId) {
                setSelectedServerId(null);
            }

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
        const server = servers.find((s) => s.id === serverId);
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

    // Handle external refresh triggers
    useEffect(() => {
        if (refreshTrigger && isOpen) {
            refetchServers();
        }
    }, [refreshTrigger, isOpen, refetchServers]);

    // Note: mcp:server-connected and resource:cache-invalidated DOM listeners removed
    // - mcp:server-connected was dead code (never dispatched as DOM event)
    // - resource invalidation handled via React Query's built-in mechanisms

    const selectedServer = servers.find((s) => s.id === selectedServerId);

    // For inline variant, just return the content wrapped
    if (variant === 'inline') {
        return (
            <aside className="h-full w-full flex flex-col bg-card">
                {/* Panel Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/50 backdrop-blur-sm">
                    <h2 className="text-sm font-semibold text-foreground">Tools & Servers</h2>
                    <div className="flex items-center space-x-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => refetchServers()}
                            disabled={isLoadingServers}
                            className="h-8 w-8 p-0"
                        >
                            <RefreshCw
                                className={cn('h-3.5 w-3.5', isLoadingServers && 'animate-spin')}
                            />
                        </Button>
                    </div>
                </div>

                {/* Add Server Actions */}
                <div className="px-4 py-3 space-y-2 border-b border-border/30">
                    <Button
                        onClick={() => setIsRegistryModalOpen(true)}
                        className="w-full h-9 text-sm font-medium"
                        size="sm"
                    >
                        <Package className="mr-2 h-4 w-4" />
                        Connect MCPs
                    </Button>
                    <Button
                        onClick={() => window.open('/playground', '_blank')}
                        className="w-full h-9 text-sm font-medium"
                        size="sm"
                        variant="outline"
                    >
                        <FlaskConical className="mr-2 h-4 w-4" />
                        MCP Playground
                    </Button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* Servers Section */}
                    <div className="p-4 border-b border-border/30">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Connected Servers ({servers.length})
                            </h3>
                        </div>

                        {/* Server Loading State */}
                        {isLoadingServers && (
                            <div className="flex items-center justify-center py-8">
                                <div className="flex flex-col items-center space-y-2">
                                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                        Loading servers...
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Server Error */}
                        {serverError && (
                            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
                                <div className="flex items-start space-x-2">
                                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-destructive">
                                            Connection Error
                                        </p>
                                        <p className="text-xs text-destructive/80 mt-1">
                                            {serverError?.message || 'Failed to load servers'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Servers List */}
                        {!isLoadingServers && servers.length === 0 && !serverError && (
                            <div className="text-center py-8">
                                <Server className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                                <p className="text-xs text-muted-foreground">
                                    No servers connected
                                </p>
                                <p className="text-xs text-muted-foreground/70 mt-1">
                                    Connect or browse the registry
                                </p>
                            </div>
                        )}

                        {servers.map((server) => (
                            <div
                                key={server.id}
                                onClick={() => setSelectedServerId(server.id)}
                                className={cn(
                                    'p-3 rounded-lg border cursor-pointer transition-all duration-200 mb-2 last:mb-0',
                                    selectedServerId === server.id
                                        ? 'bg-primary/5 border-primary/20 shadow-sm'
                                        : 'bg-background hover:bg-muted/50 border-border/50 hover:border-border'
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center space-x-2">
                                            <div
                                                className={cn(
                                                    'w-2 h-2 rounded-full flex-shrink-0',
                                                    server.status === 'connected'
                                                        ? 'bg-green-500'
                                                        : server.status === 'error'
                                                          ? 'bg-red-500'
                                                          : 'bg-yellow-500'
                                                )}
                                            />
                                            <h4 className="text-sm font-medium truncate">
                                                {server.name}
                                            </h4>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 capitalize">
                                            {server.status}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {/* Restart button */}
                                        {restartServerMutation.isPending &&
                                        restartServerMutation.variables === server.id ? (
                                            <div className="h-8 w-8 flex items-center justify-center">
                                                <RefreshCw
                                                    className="h-4 w-4 animate-spin text-muted-foreground"
                                                    role="status"
                                                    aria-label={`Restarting ${server.name}…`}
                                                />
                                            </div>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRestartServer(server.id);
                                                        }}
                                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                                                        aria-label={`Restart server ${server.name}`}
                                                        disabled={
                                                            deleteServerMutation.isPending &&
                                                            deleteServerMutation.variables ===
                                                                server.id
                                                        }
                                                    >
                                                        <RotateCw className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    Restart server
                                                </TooltipContent>
                                            </Tooltip>
                                        )}

                                        {/* Delete button */}
                                        {deleteServerMutation.isPending &&
                                        deleteServerMutation.variables === server.id ? (
                                            <div className="h-8 w-8 flex items-center justify-center">
                                                <RefreshCw
                                                    className="h-4 w-4 animate-spin text-muted-foreground"
                                                    role="status"
                                                    aria-label={`Removing ${server.name}…`}
                                                />
                                            </div>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteServer(server.id);
                                                        }}
                                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                        aria-label={`Remove server ${server.name}`}
                                                        disabled={
                                                            restartServerMutation.isPending &&
                                                            restartServerMutation.variables ===
                                                                server.id
                                                        }
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    Remove server
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Tools Section */}
                    {selectedServer && (
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <div className="px-4 py-3 border-b border-border/30">
                                <button
                                    onClick={() => setIsToolsExpanded(!isToolsExpanded)}
                                    className="flex items-center justify-between w-full text-left"
                                >
                                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        Available Tools {tools.length > 0 && `(${tools.length})`}
                                    </h3>
                                    <ChevronDown
                                        className={cn(
                                            'h-3.5 w-3.5 transition-transform text-muted-foreground',
                                            isToolsExpanded && 'rotate-180'
                                        )}
                                    />
                                </button>
                            </div>

                            {isToolsExpanded && (
                                <div className="flex-1 overflow-y-auto px-4 py-3">
                                    {/* Tools Loading State */}
                                    {isLoadingTools && (
                                        <div className="flex items-center justify-center py-6">
                                            <div className="flex flex-col items-center space-y-2">
                                                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                                                <span className="text-xs text-muted-foreground">
                                                    Loading tools...
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Tools Error */}
                                    {toolsError && (
                                        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
                                            <div className="flex items-start space-x-2">
                                                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium text-destructive">
                                                        Tools Error
                                                    </p>
                                                    <p className="text-xs text-destructive/80 mt-1">
                                                        {toolsError?.message ||
                                                            'Failed to load tools'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* No Tools */}
                                    {!isLoadingTools &&
                                        tools.length === 0 &&
                                        !toolsError &&
                                        selectedServer.status === 'connected' && (
                                            <div className="text-center py-6">
                                                <ListChecks className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                                                <p className="text-xs text-muted-foreground">
                                                    No tools available
                                                </p>
                                            </div>
                                        )}

                                    {/* Server Not Connected */}
                                    {selectedServer.status !== 'connected' && (
                                        <div className="text-center py-6">
                                            <AlertTriangle className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                                            <p className="text-xs text-muted-foreground">
                                                Server not connected
                                            </p>
                                            <p className="text-xs text-muted-foreground/70 mt-1">
                                                Tools unavailable
                                            </p>
                                        </div>
                                    )}

                                    {/* Tools List */}
                                    {tools.map((tool) => (
                                        <div
                                            key={tool.name}
                                            className="p-3 rounded-lg border border-border/50 bg-background hover:bg-muted/30 transition-colors mb-2 last:mb-0"
                                        >
                                            <h4 className="text-sm font-medium mb-1">
                                                {tool.name}
                                            </h4>
                                            {tool.description && (
                                                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                                                    {tool.description}
                                                </p>
                                            )}
                                            {tool.inputSchema?.properties && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {Object.keys(tool.inputSchema.properties)
                                                        .slice(0, 3)
                                                        .map((param) => (
                                                            <span
                                                                key={param}
                                                                className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs font-medium"
                                                            >
                                                                {param}
                                                            </span>
                                                        ))}
                                                    {Object.keys(tool.inputSchema.properties)
                                                        .length > 3 && (
                                                        <span className="text-xs text-muted-foreground">
                                                            +
                                                            {Object.keys(
                                                                tool.inputSchema.properties
                                                            ).length - 3}{' '}
                                                            more
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
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
                    'fixed top-0 right-0 z-40 h-screen w-80 bg-card border-l border-border shadow-xl transition-transform duration-300 ease-in-out flex flex-col',
                    isOpen ? 'translate-x-0' : 'translate-x-full'
                )}
            >
                {/* Panel Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/50 backdrop-blur-sm">
                    <h2 className="text-sm font-semibold text-foreground">Tools & Servers</h2>
                    <div className="flex items-center space-x-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => refetchServers()}
                            disabled={isLoadingServers}
                            className="h-8 w-8 p-0"
                        >
                            <RefreshCw
                                className={cn('h-3.5 w-3.5', isLoadingServers && 'animate-spin')}
                            />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>

                {/* Add Server Actions */}
                <div className="px-4 py-3 space-y-2 border-b border-border/30">
                    <Button
                        onClick={() => setIsRegistryModalOpen(true)}
                        className="w-full h-9 text-sm font-medium"
                        size="sm"
                    >
                        <Package className="mr-2 h-4 w-4" />
                        Connect MCPs
                    </Button>
                    <Button
                        onClick={() => window.open('/playground', '_blank')}
                        className="w-full h-9 text-sm font-medium"
                        size="sm"
                        variant="outline"
                    >
                        <FlaskConical className="mr-2 h-4 w-4" />
                        MCP Playground
                    </Button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* Servers Section */}
                    <div className="p-4 border-b border-border/30">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Connected Servers ({servers.length})
                            </h3>
                        </div>

                        {/* Server Loading State */}
                        {isLoadingServers && (
                            <div className="flex items-center justify-center py-8">
                                <div className="flex flex-col items-center space-y-2">
                                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                        Loading servers...
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Server Error */}
                        {serverError && (
                            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
                                <div className="flex items-start space-x-2">
                                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-destructive">
                                            Connection Error
                                        </p>
                                        <p className="text-xs text-destructive/80 mt-1">
                                            {serverError?.message || 'Failed to load servers'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Servers List */}
                        {!isLoadingServers && servers.length === 0 && !serverError && (
                            <div className="text-center py-8">
                                <Server className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                                <p className="text-xs text-muted-foreground">
                                    No servers connected
                                </p>
                                <p className="text-xs text-muted-foreground/70 mt-1">
                                    Connect or browse the registry
                                </p>
                            </div>
                        )}

                        {servers.map((server) => (
                            <div
                                key={server.id}
                                onClick={() => setSelectedServerId(server.id)}
                                className={cn(
                                    'p-3 rounded-lg border cursor-pointer transition-all duration-200 mb-2 last:mb-0',
                                    selectedServerId === server.id
                                        ? 'bg-primary/5 border-primary/20 shadow-sm'
                                        : 'bg-background hover:bg-muted/50 border-border/50 hover:border-border'
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center space-x-2">
                                            <div
                                                className={cn(
                                                    'w-2 h-2 rounded-full flex-shrink-0',
                                                    server.status === 'connected'
                                                        ? 'bg-green-500'
                                                        : server.status === 'error'
                                                          ? 'bg-red-500'
                                                          : 'bg-yellow-500'
                                                )}
                                            />
                                            <h4 className="text-sm font-medium truncate">
                                                {server.name}
                                            </h4>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 capitalize">
                                            {server.status}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {/* Restart button */}
                                        {restartServerMutation.isPending &&
                                        restartServerMutation.variables === server.id ? (
                                            <div className="h-8 w-8 flex items-center justify-center">
                                                <RefreshCw
                                                    className="h-4 w-4 animate-spin text-muted-foreground"
                                                    role="status"
                                                    aria-label={`Restarting ${server.name}…`}
                                                />
                                            </div>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRestartServer(server.id);
                                                        }}
                                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                                                        aria-label={`Restart server ${server.name}`}
                                                        disabled={
                                                            deleteServerMutation.isPending &&
                                                            deleteServerMutation.variables ===
                                                                server.id
                                                        }
                                                    >
                                                        <RotateCw className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    Restart server
                                                </TooltipContent>
                                            </Tooltip>
                                        )}

                                        {/* Delete button */}
                                        {deleteServerMutation.isPending &&
                                        deleteServerMutation.variables === server.id ? (
                                            <div className="h-8 w-8 flex items-center justify-center">
                                                <RefreshCw
                                                    className="h-4 w-4 animate-spin text-muted-foreground"
                                                    role="status"
                                                    aria-label={`Removing ${server.name}…`}
                                                />
                                            </div>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteServer(server.id);
                                                        }}
                                                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                        aria-label={`Remove server ${server.name}`}
                                                        disabled={
                                                            restartServerMutation.isPending &&
                                                            restartServerMutation.variables ===
                                                                server.id
                                                        }
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    Remove server
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Tools Section */}
                    {selectedServer && (
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <div className="px-4 py-3 border-b border-border/30">
                                <button
                                    onClick={() => setIsToolsExpanded(!isToolsExpanded)}
                                    className="flex items-center justify-between w-full text-left"
                                >
                                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        Available Tools
                                    </h3>
                                    <ChevronDown
                                        className={cn(
                                            'h-3.5 w-3.5 transition-transform text-muted-foreground',
                                            isToolsExpanded && 'rotate-180'
                                        )}
                                    />
                                </button>
                            </div>

                            {isToolsExpanded && (
                                <div className="flex-1 overflow-y-auto px-4 py-3">
                                    {/* Tools Loading State */}
                                    {isLoadingTools && (
                                        <div className="flex items-center justify-center py-6">
                                            <div className="flex flex-col items-center space-y-2">
                                                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                                                <span className="text-xs text-muted-foreground">
                                                    Loading tools...
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Tools Error */}
                                    {toolsError && (
                                        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
                                            <div className="flex items-start space-x-2">
                                                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-medium text-destructive">
                                                        Tools Error
                                                    </p>
                                                    <p className="text-xs text-destructive/80 mt-1">
                                                        {toolsError?.message ||
                                                            'Failed to load tools'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* No Tools */}
                                    {!isLoadingTools &&
                                        tools.length === 0 &&
                                        !toolsError &&
                                        selectedServer.status === 'connected' && (
                                            <div className="text-center py-6">
                                                <ListChecks className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                                                <p className="text-xs text-muted-foreground">
                                                    No tools available
                                                </p>
                                            </div>
                                        )}

                                    {/* Server Not Connected */}
                                    {selectedServer.status !== 'connected' && (
                                        <div className="text-center py-6">
                                            <AlertTriangle className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                                            <p className="text-xs text-muted-foreground">
                                                Server not connected
                                            </p>
                                            <p className="text-xs text-muted-foreground/70 mt-1">
                                                Tools unavailable
                                            </p>
                                        </div>
                                    )}

                                    {/* Tools List */}
                                    {tools.map((tool) => (
                                        <div
                                            key={tool.name}
                                            className="p-3 rounded-lg border border-border/50 bg-background hover:bg-muted/30 transition-colors mb-2 last:mb-0"
                                        >
                                            <h4 className="text-sm font-medium mb-1">
                                                {tool.name}
                                            </h4>
                                            {tool.description && (
                                                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                                                    {tool.description}
                                                </p>
                                            )}
                                            {tool.inputSchema?.properties && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {Object.keys(tool.inputSchema.properties)
                                                        .slice(0, 3)
                                                        .map((param) => (
                                                            <span
                                                                key={param}
                                                                className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs font-medium"
                                                            >
                                                                {param}
                                                            </span>
                                                        ))}
                                                    {Object.keys(tool.inputSchema.properties)
                                                        .length > 3 && (
                                                        <span className="text-xs text-muted-foreground">
                                                            +
                                                            {Object.keys(
                                                                tool.inputSchema.properties
                                                            ).length - 3}{' '}
                                                            more
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
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
