'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/api-url';
import { queryKeys } from '@/lib/queryKeys.js';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ChevronDown, Check, DownloadCloud, Sparkles, Trash2, BadgeCheck, Plus } from 'lucide-react';
import { useChatContext } from '../hooks/ChatContext';
import CreateAgentModal from './CreateAgentModal';
import { useAnalytics } from '@/lib/analytics/index.js';

type AgentItem = {
  id: string;
  name: string;
  description: string;
  author?: string;
  tags?: string[];
  type: 'builtin' | 'custom';
};

type AgentsResponse = {
  installed: AgentItem[];
  available: AgentItem[];
  current: { id: string | null; name: string | null };
};

type AgentPath = {
  path: string;
  name: string;
  relativePath: string;
  isDefault: boolean;
};

type RecentAgent = {
  id: string;
  name: string;
  path: string;
  lastUsed: number;
};

type AgentSelectorProps = {
  mode?: 'default' | 'badge' | 'title';
};

const RECENT_AGENTS_KEY = 'dexto:recentAgents';
const MAX_RECENT_AGENTS = 5;

export default function AgentSelector({ mode = 'default' }: AgentSelectorProps) {
  const router = useRouter();
  const { returnToWelcome, currentLLM, currentSessionId } = useChatContext();
  const analytics = useAnalytics();
  const analyticsRef = useRef(analytics);

  const [recentAgents, setRecentAgents] = useState<RecentAgent[]>([]);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Keep analytics ref up to date to avoid stale closure issues
  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  const queryClient = useQueryClient();

  // Fetch agents list using TanStack Query
  const {
    data: agentsData,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useQuery<AgentsResponse, Error>({
    queryKey: queryKeys.agents.all,
    queryFn: async () => {
      const res = await fetch(`${getApiUrl()}/api/agents`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      return res.json() as Promise<AgentsResponse>;
    },
  });

  const installed = agentsData?.installed || [];
  const available = agentsData?.available || [];
  const currentId = agentsData?.current.id || null;

  // Fetch current agent path using TanStack Query
  const {
    data: currentAgentPathData,
  } = useQuery<AgentPath, Error>({
    queryKey: queryKeys.agents.path,
    queryFn: async () => {
      const pathRes = await fetch(`${getApiUrl()}/api/agent/path`);
      if (!pathRes.ok) throw new Error('Failed to fetch agent path');
      return pathRes.json() as Promise<AgentPath>;
    },
    retry: false, // Don't retry if path fetch fails
  });

  const currentAgentPath = currentAgentPathData ?? null;

  // Save agent to recent list
  const addToRecentAgents = useCallback((agent: { id: string; name: string; path: string }) => {
    try {
      const stored = localStorage.getItem(RECENT_AGENTS_KEY);
      const recent = stored ? (JSON.parse(stored) as RecentAgent[]) : [];
      const filtered = recent.filter(a => a.path !== agent.path);
      const updated: RecentAgent[] = [
        { ...agent, lastUsed: Date.now() },
        ...filtered
      ].slice(0, MAX_RECENT_AGENTS);

      localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(updated));
      setRecentAgents(updated);
    } catch (err) {
      console.error('Failed to save recent agent:', err);
    }
  }, []);

  // Agent switch mutation
  const switchAgentMutation = useMutation({
    mutationFn: async ({ id, path }: { id: string; path?: string }) => {
      const res = await fetch(`${getApiUrl()}/api/agents/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...(path ? { path } : {}) }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // Extract error message from various API response formats
        const errorMessage =
          errorData.error ||
          errorData.message ||
          (errorData.issues && errorData.issues[0]?.message) ||
          `Switch failed: ${res.status} ${res.statusText}`;
        throw new Error(errorMessage);
      }
      return { id, path };
    },
    onSuccess: () => {
      // Invalidate and refetch agents and path after successful switch
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.path });
    },
  });

  // Agent install mutation (no chaining - coordination happens in handleInstall)
  const installAgentMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`${getApiUrl()}/api/agents/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // Extract error message from various API response formats
        const errorMessage =
          errorData.error ||
          errorData.message ||
          (errorData.issues && errorData.issues[0]?.message) ||
          `Install failed: ${res.status}`;
        throw new Error(errorMessage);
      }
      return agentId;
    },
    onSuccess: async () => {
      // Just invalidate the cache - let handleInstall coordinate the full flow
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });

  // Agent delete mutation
  const deleteAgentMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`${getApiUrl()}/api/agents/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // Extract error message from various API response formats
        const errorMessage =
          errorData.error ||
          errorData.message ||
          (errorData.issues && errorData.issues[0]?.message) ||
          `Delete failed: ${res.status}`;
        throw new Error(errorMessage);
      }
      return agentId;
    },
    onSuccess: () => {
      // Invalidate and refetch agents after successful delete
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.path });
    },
  });

  // Load recent agents from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_AGENTS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as RecentAgent[];
      setRecentAgents(parsed.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_RECENT_AGENTS));
    } catch (err) {
      console.error('Failed to load recent agents:', err);
      localStorage.removeItem(RECENT_AGENTS_KEY);
    }
  }, []);

  // Sync current agent path to recent agents when it loads
  useEffect(() => {
    if (currentAgentPath?.path && currentAgentPath?.name) {
      addToRecentAgents({
        id: currentAgentPath.name,
        name: currentAgentPath.name,
        path: currentAgentPath.path
      });
    }
  }, [currentAgentPath, addToRecentAgents]);

  const loading = agentsLoading;

  const handleSwitch = useCallback(async (agentId: string) => {
    try {
      setSwitching(true);
      // Check if the agent exists in the installed list
      const agent = installed.find(agent => agent.id === agentId);
      if (!agent) {
        console.error(`Agent not found in installed list: ${agentId}`);
        throw new Error(`Agent '${agentId}' not found. Please refresh the agents list.`);
      }

      // Capture current agent ID before switch
      const fromAgentId = currentId;

      await switchAgentMutation.mutateAsync({ id: agentId });

      setOpen(false); // Close dropdown after successful switch

      // Track agent switch using ref to avoid stale closure
      analyticsRef.current.trackAgentSwitched({
        fromAgentId,
        toAgentId: agentId,
        toAgentName: agent.name,
        sessionId: currentSessionId || undefined,
      });

      try {
        window.dispatchEvent(
          new CustomEvent('dexto:agentSwitched', {
            detail: { id: agentId, name: agent.name },
          })
        );
      } catch {}

      // Navigate back to home after switching agents
      returnToWelcome();
      router.push('/');
    } catch (err) {
      console.error(`Switch agent failed: ${err instanceof Error ? err.message : String(err)}`);
      const errorMessage = err instanceof Error ? err.message : 'Failed to switch agent';
      alert(`Failed to switch agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [returnToWelcome, installed, switchAgentMutation, router, currentId, currentSessionId]);

  const handleSwitchToPath = useCallback(async (agent: { id: string; name: string; path: string }) => {
    try {
      setSwitching(true);

      // Capture current agent ID before switch
      const fromAgentId = currentId;

      await switchAgentMutation.mutateAsync({ id: agent.id, path: agent.path });

      setOpen(false); // Close dropdown after successful switch

      // Add to recent agents
      addToRecentAgents(agent);

      // Track agent switch using ref to avoid stale closure
      analyticsRef.current.trackAgentSwitched({
        fromAgentId,
        toAgentId: agent.id,
        toAgentName: agent.name,
        sessionId: currentSessionId || undefined,
      });

      try {
        window.dispatchEvent(
          new CustomEvent('dexto:agentSwitched', {
            detail: { id: agent.id, name: agent.name },
          })
        );
      } catch {}

      // Navigate back to home after switching agents
      returnToWelcome();
      router.push('/');
    } catch (err) {
      console.error(`Switch agent failed: ${err instanceof Error ? err.message : String(err)}`);
      const errorMessage = err instanceof Error ? err.message : 'Failed to switch agent';
      alert(`Failed to switch agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [returnToWelcome, addToRecentAgents, switchAgentMutation, router, currentId, currentSessionId]);

  const handleInstall = useCallback(async (agentId: string) => {
    try {
      setSwitching(true);

      // Capture current agent ID before operations
      const fromAgentId = currentId;

      // Step 1: Install the agent
      await installAgentMutation.mutateAsync(agentId);

      // Step 2: Verify agent is now in installed list
      const freshData = queryClient.getQueryData<AgentsResponse>(queryKeys.agents.all);
      const agent = freshData?.installed.find(a => a.id === agentId);
      if (!agent) {
        throw new Error(`Agent '${agentId}' not found after installation. Please refresh.`);
      }

      // Step 3: Switch to the newly installed agent
      await switchAgentMutation.mutateAsync({ id: agentId });

      setOpen(false);

      // Step 4: Track the switch analytics
      analyticsRef.current.trackAgentSwitched({
        fromAgentId,
        toAgentId: agentId,
        toAgentName: agent.name,
        sessionId: currentSessionId || undefined,
      });

      // Step 5: Dispatch event
      try {
        window.dispatchEvent(
          new CustomEvent('dexto:agentSwitched', {
            detail: { id: agentId, name: agent.name },
          })
        );
      } catch {}

      // Step 6: Return to welcome
      returnToWelcome();
    } catch (err) {
      console.error(`Install/switch agent failed: ${err instanceof Error ? err.message : String(err)}`);
      const errorMessage = err instanceof Error ? err.message : 'Failed to install/switch agent';
      alert(`Failed to install/switch agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [installAgentMutation, switchAgentMutation, returnToWelcome, currentId, currentSessionId, queryClient, analyticsRef]);

  const handleDelete = useCallback(async (agent: AgentItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering switch when clicking delete
    if (!confirm(`Are you sure you want to delete the custom agent "${agent.name}"?`)) {
      return;
    }
    try {
      setSwitching(true);
      await deleteAgentMutation.mutateAsync(agent.id);
    } catch (err) {
      console.error(`Delete agent failed: ${err instanceof Error ? err.message : String(err)}`);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete agent';
      alert(`Failed to delete agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [deleteAgentMutation]);

  const currentLabel = useMemo(() => {
    if (!currentId) return 'Choose Agent';
    const match = installed.find(agent => agent.id === currentId) || available.find(agent => agent.id === currentId);
    return match?.name ?? currentId;
  }, [available, currentId, installed]);

  const handleAgentCreated = useCallback(async (_agentName: string) => {
    // Add a small delay to ensure the agent is fully installed
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Reload agents list to show the newly created agent
    await refetchAgents();
    // Note: We don't automatically switch to the newly created agent to avoid race conditions
    // The user can manually switch to it from the dropdown
  }, [refetchAgents]);

  const getButtonClassName = (mode: string) => {
    const baseClasses = 'transition-all duration-200 shadow-lg hover:shadow-xl font-semibold rounded-full';

    switch (mode) {
      case 'badge':
        return `h-9 px-4 text-xs border border-teal-500 bg-teal-500/20 text-teal-600 hover:bg-teal-500/40 hover:border-teal-500 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 dark:border-teal-400 dark:hover:border-teal-300 min-w-[100px] max-w-[140px] md:min-w-[140px] md:max-w-[240px] lg:max-w-[400px] xl:max-w-[500px] ${baseClasses}`;
      case 'title':
        return `h-11 px-4 text-lg font-bold bg-gradient-to-r from-teal-500/30 to-teal-500/40 text-teal-600 hover:from-teal-500/50 hover:to-teal-500/60 hover:text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2 border border-teal-500/40 dark:text-teal-400 dark:hover:text-teal-300 dark:border-teal-400 ${baseClasses}`;
      default:
        return `h-10 px-3 text-sm bg-teal-500/40 text-teal-600 hover:bg-teal-500/50 hover:text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2 border border-teal-500/50 dark:text-teal-400 dark:hover:text-teal-300 dark:border-teal-400 ${baseClasses}`;
    }
  };

  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={mode === 'badge' ? 'outline' : 'default'}
          size="sm"
          className={getButtonClassName(mode)}
          disabled={switching}
        >
          <div className="flex items-center justify-between w-full min-w-0">
            <Sparkles className="w-4 h-4 mr-2 flex-shrink-0" />
            <span className="flex-1 text-center truncate min-w-0 px-1">
              {switching ? 'Switching...' : mode === 'title' ? `Agent: ${currentLabel}` : currentLabel}
            </span>
            <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto">
        {loading && (
          <DropdownMenuItem disabled className="text-center text-muted-foreground">
            Loading agents...
          </DropdownMenuItem>
        )}
        {!loading && (
          <>
            {/* Create New Agent Button */}
            <DropdownMenuItem
              onClick={() => {
                setCreateModalOpen(true);
                setOpen(false);
              }}
              disabled={switching}
              className="cursor-pointer py-3 bg-gradient-to-r from-purple-500/10 to-purple-500/5 hover:from-purple-500/20 hover:to-purple-500/10 border-b border-purple-500/20"
            >
              <div className="flex items-center gap-2 w-full">
                <Plus className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="font-semibold text-purple-600 dark:text-purple-400">New Agent</span>
              </div>
            </DropdownMenuItem>

            {/* Current Agent (if loaded from file and not in installed list) */}
            {currentAgentPath && !installed.some(a => a.id === currentAgentPath.name) && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-teal-600 dark:text-teal-400 uppercase tracking-wider">
                  Currently Active
                </div>
                <DropdownMenuItem
                  onClick={() => handleSwitchToPath({
                    id: currentAgentPath.name,
                    name: currentAgentPath.name,
                    path: currentAgentPath.path
                  })}
                  disabled={switching || currentId === currentAgentPath.name}
                  className="cursor-pointer py-3"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{currentAgentPath.name}</span>
                        {currentId === currentAgentPath.name && (
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0 animate-in fade-in duration-200" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        Loaded from file
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            {/* Recent Agents */}
            {recentAgents.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recent
                </div>
                {recentAgents
                  .filter(ra =>
                    !installed.some(a => a.id === ra.id) &&
                    ra.id !== currentAgentPath?.name &&
                    !ra.path.includes('/.dexto/') // Filter out global dexto directory agents
                  )
                  .slice(0, 3)
                  .map((agent) => (
                    <DropdownMenuItem
                      key={agent.path}
                      onClick={() => handleSwitchToPath(agent)}
                      disabled={switching || agent.id === currentId}
                      className="cursor-pointer py-3"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{agent.name}</span>
                            {agent.id === currentId && (
                              <Check className="w-4 h-4 text-green-600 flex-shrink-0 animate-in fade-in duration-200" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate" title={agent.path}>
                            {agent.path}
                          </p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuSeparator />
              </>
            )}

            {/* Installed Custom Agents */}
            {installed.filter((a) => a.type === 'custom').length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
                  <BadgeCheck className="w-3 h-3" />
                  Custom Agents
                </div>
                {installed
                  .filter((a) => a.type === 'custom')
                  .map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onClick={() => handleSwitch(agent.id)}
                      disabled={switching || agent.id === currentId}
                      className="cursor-pointer py-3"
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{agent.name}</span>
                            {agent.id === currentId && (
                              <Check className="w-4 h-4 text-green-600 flex-shrink-0 animate-in fade-in duration-200" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {agent.description}
                          </p>
                          {agent.author && (
                            <p className="text-xs text-muted-foreground/80 mt-0.5">
                              by {agent.author}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={(e) => handleDelete(agent, e)}
                          disabled={switching}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                          title="Delete custom agent"
                        >
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    </DropdownMenuItem>
                  ))}
              </>
            )}
            {/* Installed Builtin Agents */}
            {installed.filter((a) => a.type === 'builtin').length > 0 && (
              <>
                {installed.filter((a) => a.type === 'custom').length > 0 && <DropdownMenuSeparator />}
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Installed
                </div>
                {installed
                  .filter((a) => a.type === 'builtin')
                  .map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onClick={() => handleSwitch(agent.id)}
                      disabled={switching || agent.id === currentId}
                      className="cursor-pointer py-3"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{agent.name}</span>
                            {agent.id === currentId && (
                              <Check className="w-4 h-4 text-green-600 flex-shrink-0 animate-in fade-in duration-200" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {agent.description}
                          </p>
                          {agent.author && (
                            <p className="text-xs text-muted-foreground/80 mt-0.5">
                              by {agent.author}
                            </p>
                          )}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
              </>
            )}
            {/* Available Builtin Agents */}
            {available.filter((a) => a.type === 'builtin').length > 0 && (
              <>
                {installed.length > 0 && <DropdownMenuSeparator />}
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Available
                </div>
                {available
                  .filter((a) => a.type === 'builtin')
                  .map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onClick={() => handleInstall(agent.id)}
                      disabled={switching}
                      className="cursor-pointer py-3"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{agent.name}</span>
                            <DownloadCloud className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {agent.description}
                          </p>
                          {agent.author && (
                            <p className="text-xs text-muted-foreground/80 mt-0.5">
                              by {agent.author}
                            </p>
                          )}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
              </>
            )}
            {!loading && installed.length === 0 && available.length === 0 && (
              <DropdownMenuItem disabled className="text-center text-muted-foreground">
                No agents found
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

    <CreateAgentModal
      open={createModalOpen}
      onOpenChange={setCreateModalOpen}
      onAgentCreated={handleAgentCreated}
    />
    </>
  );
}
