'use client';

import React from 'react';
import { Server, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { McpServer } from '@/components/hooks/useServers';

interface ServersListProps {
    servers: McpServer[];
    selectedServer: McpServer | null;
    isLoading: boolean;
    error: string | null;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onServerSelect: (server: McpServer) => void;
    onConnectNew: () => void;
}

export function ServersList({
    servers,
    selectedServer,
    isLoading,
    error,
    searchQuery,
    onSearchChange,
    onServerSelect,
    onConnectNew,
}: ServersListProps) {
    const filteredServers = servers.filter((server) =>
        server.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusIcon = (status: McpServer['status']) => {
        switch (status) {
            case 'connected':
                return <Check className="h-3 w-3" />;
            case 'error':
                return <AlertCircle className="h-3 w-3" />;
            case 'disconnected':
            default:
                return <Loader2 className="h-3 w-3 animate-spin" />;
        }
    };

    const getStatusColor = (status: McpServer['status']) => {
        switch (status) {
            case 'connected':
                return 'bg-green-100 text-green-700 dark:bg-green-700/20 dark:text-green-400';
            case 'error':
                return 'bg-red-100 text-red-700 dark:bg-red-700/20 dark:text-red-400';
            case 'disconnected':
                return 'bg-slate-100 text-slate-600 dark:bg-slate-700/20 dark:text-slate-400';
            default:
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-700/20 dark:text-yellow-400';
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="pb-3 mb-3 border-b border-border">
                <div className="flex items-center gap-2 mb-3">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">MCP Servers</h2>
                    {isLoading && servers.length === 0 && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
                    )}
                </div>

                <Input
                    placeholder="Search servers..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="h-8 text-sm"
                />
            </div>

            {/* Error State */}
            {error && servers.length === 0 && !isLoading && (
                <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                    <p className="font-medium">Error loading servers</p>
                    <p className="text-xs mt-1">{error}</p>
                </div>
            )}

            {/* Loading State */}
            {isLoading && servers.length === 0 && (
                <div className="flex-1 space-y-2 pr-1">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="p-2.5 rounded-lg border border-border">
                            <div className="flex items-center justify-between gap-2">
                                <Skeleton className="h-4 flex-1" />
                                <Skeleton className="h-5 w-16" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Empty State */}
            {servers.length === 0 && !isLoading && !error && (
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center">
                        <Server className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">No servers available</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Connect a server to get started
                        </p>
                    </div>
                </div>
            )}

            {/* Servers List */}
            {filteredServers.length > 0 && (
                <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                    {filteredServers.map((server) => (
                        <button
                            key={server.id}
                            onClick={() => server.status === 'connected' && onServerSelect(server)}
                            disabled={server.status !== 'connected'}
                            className={cn(
                                'w-full p-2.5 rounded-lg text-left transition-all duration-200',
                                'hover:shadow-sm border border-transparent',
                                selectedServer?.id === server.id
                                    ? 'bg-primary text-primary-foreground shadow-sm border-primary/20'
                                    : 'hover:bg-muted hover:border-border',
                                server.status !== 'connected' && 'opacity-50 cursor-not-allowed'
                            )}
                            title={
                                server.status !== 'connected'
                                    ? `${server.name} is ${server.status}`
                                    : server.name
                            }
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm truncate">{server.name}</span>
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        'text-xs px-1.5 py-0 h-5 flex items-center gap-1',
                                        getStatusColor(server.status)
                                    )}
                                >
                                    {getStatusIcon(server.status)}
                                    {server.status}
                                </Badge>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* No Results */}
            {filteredServers.length === 0 && servers.length > 0 && (
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-sm text-muted-foreground">No servers match your search</p>
                </div>
            )}

            {/* Connect Button */}
            <Button
                onClick={onConnectNew}
                variant="outline"
                className="mt-auto w-full sticky bottom-0 bg-background"
                size="sm"
            >
                <Server className="h-4 w-4 mr-2" />
                Connect New Server
            </Button>
        </div>
    );
}
