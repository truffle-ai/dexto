'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { X, PlusCircle, Server, ListChecks, ChevronRight, RefreshCw, AlertTriangle, ChevronDown, Terminal, Trash2, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { McpServer, McpTool, ServerRegistryEntry } from '@/types';
import type { McpServerConfig } from '@dexto/client-sdk';
import { serverRegistry } from '@/lib/serverRegistry';
import ServerRegistryModal from './ServerRegistryModal';

interface ServersPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenConnectModal: () => void;
  onOpenConnectWithPrefill?: (opts: {
    name: string;
    config: Partial<McpServerConfig> & { type?: 'stdio' | 'sse' | 'http' };
    lockName?: boolean;
    registryEntryId?: string;
  }) => void;
  variant?: 'overlay' | 'inline';
  refreshTrigger?: number; // Add a trigger to force refresh
}

const API_BASE_URL = '/api'; // Assuming Next.js API routes

function buildConfigFromRegistryEntry(entry: ServerRegistryEntry) {
  return {
    type: entry.config.type,
    command: entry.config.command,
    args: entry.config.args || [],
    url: entry.config.url,
    env: entry.config.env || {},
    headers: entry.config.headers || {},
    timeout: entry.config.timeout || 30000,
  };
}

export default function ServersPanel({ isOpen, onClose, onOpenConnectModal, onOpenConnectWithPrefill, variant = 'overlay', refreshTrigger }: ServersPanelProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [isToolsExpanded, setIsToolsExpanded] = useState(false); // State for tools section collapse
  const [isDeletingServer, setIsDeletingServer] = useState<string | null>(null); // Tracks which server is being deleted
  const [isRegistryModalOpen, setIsRegistryModalOpen] = useState(false);

  const handleError = (message: string, area: 'servers' | 'tools' | 'delete') => {
    console.error(`ServersPanel Error (${area}):`, message);
    if (area === 'servers') setServerError(message);
    if (area === 'tools') setToolsError(message);
    // Potentially a specific error state for delete if needed
  };

  const fetchServers = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingServers(true);
    setServerError(null);
    setServers([]); // Clear existing servers
    setSelectedServerId(null); // Reset selected server
    setTools([]); // Clear tools
    setToolsError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/mcp/servers`, signal ? { signal } : {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch servers' }));
        throw new Error(errorData.message || errorData.error || `Server List: ${response.statusText}`);
      }
      const data = await response.json();
      const fetchedServers = data.servers || [];
      setServers(fetchedServers);
      if (fetchedServers.length > 0) {
        // Auto-select the first connected server if available
        const firstConnected = fetchedServers.find((s: McpServer) => s.status === 'connected');
        if (firstConnected) {
          setSelectedServerId(firstConnected.id);
        } else if (fetchedServers.length > 0) {
          setSelectedServerId(fetchedServers[0].id); // Select first server if none are connected
        }
      } else {
        console.log("No MCP servers found or returned from API.");
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        const message = err instanceof Error ? err.message : String(err);
        handleError(message, 'servers');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingServers(false);
      }
    }
  }, []);

  const handleInstallServer = async (entry: ServerRegistryEntry) => {
    // Close the registry modal first
    setIsRegistryModalOpen(false);

    // If parent supports prefilled connect modal, use it instead of immediate connect
    if (typeof onOpenConnectWithPrefill === 'function') {
      const config = buildConfigFromRegistryEntry(entry);
      onOpenConnectWithPrefill({ name: entry.name, config, lockName: true, registryEntryId: entry.id });
      return;
    }

    // Fallback: connect immediately via API
    try {
      const res = await fetch('/api/connect-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: entry.name, config: buildConfigFromRegistryEntry(entry) }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || `Server returned status ${res.status}`);
      }
      await fetchServers();
      
      // Sync registry after installation
      try {
        await serverRegistry.syncWithServerStatus();
      } catch (e) {
        console.warn('Failed to sync registry after server install:', e);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install server';
      throw new Error(message);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    if (!window.confirm(`Are you sure you want to remove server "${server.name}"?`)) {
      return;
    }

    setIsDeletingServer(serverId);
    setServerError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/mcp/servers/${serverId}`, { method: 'DELETE' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to remove server' }));
        throw new Error(errorData.message || errorData.error || `Server Removal: ${response.statusText}`);
      }

      // If this was the selected server, deselect it
      if (selectedServerId === serverId) {
        setSelectedServerId(null);
        setTools([]);
      }

      // Mark corresponding registry entry as uninstalled if any alias matches this server id
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
        // non-fatal if registry update fails
        console.warn('Failed to update registry installed state on delete:', e);
      }

      await fetchServers(); // Refresh server list
      
      // Sync registry with updated server status
      try {
        await serverRegistry.syncWithServerStatus();
      } catch (e) {
        // Non-fatal; continue
        console.warn('Failed to sync registry status after server deletion:', e);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handleError(message, 'servers');
    } finally {
      setIsDeletingServer(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetchServers(controller.signal);
    // When panel opens, ensure no server is stuck in deleting state from a previous quick close
    setIsDeletingServer(null); 
    return () => {
      controller.abort();
    };
  }, [isOpen, fetchServers]);

  // Effect to handle external refresh triggers
  useEffect(() => {
    if (refreshTrigger && isOpen) {
      const controller = new AbortController();
      fetchServers(controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [refreshTrigger, isOpen, fetchServers]);

  const handleServerSelect = useCallback(async (serverId: string, signal?: AbortSignal) => {
    const server = servers.find(s => s.id === serverId);
    setTools([]);
    setToolsError(null);

    if (!server || server.status !== 'connected') {
      console.warn(`Server "${server?.name || serverId}" is not connected or not found. Cannot fetch tools.`);
      // Tools list will be empty, UI should reflect server status
      return;
    }

    setIsLoadingTools(true);
    try {
      const response = await fetch(`${API_BASE_URL}/mcp/servers/${serverId}/tools`, signal ? { signal } : {});
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Failed to fetch tools for ${server.name}` }));
        throw new Error(errorData.message || errorData.error || `Tool List (${server.name}): ${response.statusText}`);
      }
      const data = await response.json();
      if (!signal?.aborted) {
        setTools(data.tools || []);
      }
      if (!data.tools || data.tools.length === 0) {
        console.log(`No tools found for server "${server.name}".`);
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        const message = err instanceof Error ? err.message : String(err);
        handleError(message, 'tools');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingTools(false);
      }
    }
  }, [servers]);

  useEffect(() => {
    if (!selectedServerId) return;
    const controller = new AbortController();
    handleServerSelect(selectedServerId, controller.signal);
    return () => {
      controller.abort();
    };
  }, [selectedServerId, handleServerSelect]);

  const selectedServer = servers.find(s => s.id === selectedServerId);

  // For overlay variant, unmount if not open. Inline variant handles visibility via parent.
  if (variant === 'overlay' && !isOpen) {
    return null;
  }

  // Determine wrapper classes based on variant
  const overlayClass = cn(
    "fixed top-0 right-0 z-40 h-screen w-80 bg-card border-l border-border shadow-xl transition-transform transform flex flex-col",
    isOpen ? "translate-x-0" : "translate-x-full"
  );
  // Simplified for inline: parent div in ChatApp will handle width, border, shadow transitions.
  const inlineClass = cn("h-full w-full flex flex-col bg-card");

  return (
    <aside className={variant === 'overlay' ? overlayClass : inlineClass}>
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <h2 className="text-sm font-semibold text-foreground">Tools & Servers</h2>
        <div className="flex items-center space-x-1">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => fetchServers()} 
            disabled={isLoadingServers} 
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoadingServers && "animate-spin")} />
          </Button>
          {variant === 'overlay' && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose} 
              className="h-8 w-8 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Add Server Actions */}
      <div className="px-4 py-3 space-y-2 border-b border-border/30">
        <Button 
          onClick={onOpenConnectModal} 
          className="w-full h-9 text-sm font-medium"
          size="sm"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Connect Server
        </Button>
        <Button 
          onClick={() => setIsRegistryModalOpen(true)} 
          variant="outline" 
          className="w-full h-9 text-sm font-medium"
          size="sm"
        >
          <Package className="mr-2 h-4 w-4" />
          Browse Registry
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
                <span className="text-xs text-muted-foreground">Loading servers...</span>
              </div>
            </div>
          )}

          {/* Server Error */}
          {serverError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-destructive">Connection Error</p>
                  <p className="text-xs text-destructive/80 mt-1">{serverError}</p>
                </div>
              </div>
            </div>
          )}

          {/* Servers List */}
          {!isLoadingServers && servers.length === 0 && !serverError && (
            <div className="text-center py-8">
              <Server className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No servers connected</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Connect or browse the registry</p>
            </div>
          )}

          {servers.map((server) => (
            <div
              key={server.id}
              onClick={() => setSelectedServerId(server.id)}
              className={cn(
                "p-3 rounded-lg border cursor-pointer transition-all duration-200 mb-2 last:mb-0",
                selectedServerId === server.id
                  ? "bg-primary/5 border-primary/20 shadow-sm"
                  : "bg-background hover:bg-muted/50 border-border/50 hover:border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      server.status === 'connected' ? "bg-green-500" : 
                      server.status === 'error' ? "bg-red-500" : "bg-yellow-500"
                    )} />
                    <h4 className="text-sm font-medium truncate">{server.name}</h4>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">
                    {server.status}
                  </p>
                </div>
                
                {isDeletingServer === server.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteServer(server.id);
                    }}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
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
                    "h-3.5 w-3.5 transition-transform text-muted-foreground",
                    isToolsExpanded && "rotate-180"
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
                      <span className="text-xs text-muted-foreground">Loading tools...</span>
                    </div>
                  </div>
                )}

                {/* Tools Error */}
                {toolsError && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-3">
                    <div className="flex items-start space-x-2">
                      <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-destructive">Tools Error</p>
                        <p className="text-xs text-destructive/80 mt-1">{toolsError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* No Tools */}
                {!isLoadingTools && tools.length === 0 && !toolsError && selectedServer.status === 'connected' && (
                  <div className="text-center py-6">
                    <ListChecks className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No tools available</p>
                  </div>
                )}

                {/* Server Not Connected */}
                {selectedServer.status !== 'connected' && (
                  <div className="text-center py-6">
                    <AlertTriangle className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Server not connected</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Tools unavailable</p>
                  </div>
                )}

                {/* Tools List */}
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="p-3 rounded-lg border border-border/50 bg-background hover:bg-muted/30 transition-colors mb-2 last:mb-0"
                  >
                    <h4 className="text-sm font-medium mb-1">{tool.name}</h4>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {tool.description}
                      </p>
                    )}
                    {tool.inputSchema?.properties && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.keys(tool.inputSchema.properties).slice(0, 3).map((param) => (
                          <span
                            key={param}
                            className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs font-medium"
                          >
                            {param}
                          </span>
                        ))}
                        {Object.keys(tool.inputSchema.properties).length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{Object.keys(tool.inputSchema.properties).length - 3} more
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
      />
    </aside>
  );
} 
