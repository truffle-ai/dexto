'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl } from '@/lib/api-url';
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

  const [installed, setInstalled] = useState<AgentItem[]>([]);
  const [available, setAvailable] = useState<AgentItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentAgentPath, setCurrentAgentPath] = useState<AgentPath | null>(null);
  const [recentAgents, setRecentAgents] = useState<RecentAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Keep analytics ref up to date to avoid stale closure issues
  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  // Load recent agents from localStorage
  const loadRecentAgents = useCallback((): RecentAgent[] => {
    try {
      const stored = localStorage.getItem(RECENT_AGENTS_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored) as RecentAgent[];
      // Sort by lastUsed descending
      return parsed.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_RECENT_AGENTS);
    } catch (err) {
      console.error('Failed to load recent agents:', err);
      // Clear corrupted data
      localStorage.removeItem(RECENT_AGENTS_KEY);
      return [];
    }
  }, []);

  // Save agent to recent list
  const addToRecentAgents = useCallback((agent: { id: string; name: string; path: string }) => {
    try {
      const recent = loadRecentAgents();
      // Remove existing entry if present
      const filtered = recent.filter(a => a.path !== agent.path);
      // Add to front
      const updated: RecentAgent[] = [
        { ...agent, lastUsed: Date.now() },
        ...filtered
      ].slice(0, MAX_RECENT_AGENTS);

      localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(updated));
      setRecentAgents(updated);
    } catch (err) {
      console.error('Failed to save recent agent:', err);
    }
  }, [loadRecentAgents]);

  const loadAgents = useCallback(async (): Promise<AgentsResponse | null> => {
    try {
      // Fetch agents list
      const res = await fetch(`${getApiUrl()}/api/agents`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data: AgentsResponse = await res.json();
      setInstalled(data.installed || []);
      setAvailable(data.available || []);
      setCurrentId(data.current.id);

      // Fetch current agent path
      try {
        const pathRes = await fetch(`${getApiUrl()}/api/agent/path`);
        if (pathRes.ok) {
          const pathData: AgentPath = await pathRes.json();
          setCurrentAgentPath(pathData);
          // Add current agent to recent list
          if (pathData.path && pathData.name) {
            addToRecentAgents({
              id: pathData.name,
              name: pathData.name,
              path: pathData.path
            });
          }
        }
      } catch (pathErr) {
        console.error('Failed to fetch agent path:', pathErr);
      }

      return data;
    } catch (err) {
      console.error(`AgentSelector load error: ${err}`);
      return null;
    }
  }, [addToRecentAgents]);

  useEffect(() => {
    setLoading(true);
    // Load recent agents from localStorage
    setRecentAgents(loadRecentAgents());
    // Load agents from API
    loadAgents().finally(() => setLoading(false));
  }, [loadAgents, loadRecentAgents]);

  const handleSwitch = useCallback(async (agentId: string) => {
    try {
      setSwitching(true);
      // Check if the agent exists in the installed list
      const agent = installed.find(agent => agent.id === agentId);
      if (!agent) {
        console.error(`Agent not found in installed list: ${agentId}`);
        throw new Error(`Agent '${agentId}' not found. Please refresh the agents list.`);
      }

      // Capture current LLM before switch
      const fromLLM = currentLLM;

      const res = await fetch(`${getApiUrl()}/api/agents/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error(`Agent switch failed: ${JSON.stringify(errorData)}`);
        throw new Error(errorData.error || errorData.message || `Switch failed: ${res.status} ${res.statusText}`);
      }
      setCurrentId(agentId);
      setOpen(false); // Close dropdown after successful switch

      // Refresh agent list and current path to reflect the switch
      await loadAgents();

      // Fetch the new LLM config after switch
      let toLLM = null;
      try {
        const llmRes = await fetch(`${getApiUrl()}/api/llm/current`);
        if (llmRes.ok) {
          const llmData = await llmRes.json();
          toLLM = llmData.config || llmData;
        }
      } catch (e) {
        console.warn('Failed to fetch new LLM config:', e);
      }

      // Track LLM switch using ref to avoid stale closure
      if (fromLLM && toLLM) {
        analyticsRef.current.trackLLMSwitched({
          fromProvider: fromLLM.provider,
          fromModel: fromLLM.model,
          toProvider: toLLM.provider,
          toModel: toLLM.model,
          sessionId: currentSessionId || undefined,
          trigger: 'user_action',
        });
      }

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
  }, [returnToWelcome, installed, loadAgents, router, currentLLM, currentSessionId, analytics]);

  const handleSwitchToPath = useCallback(async (agent: { id: string; name: string; path: string }) => {
    try {
      setSwitching(true);

      const res = await fetch(`${getApiUrl()}/api/agents/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, path: agent.path }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error(`Agent switch failed: ${JSON.stringify(errorData)}`);
        throw new Error(errorData.error || errorData.message || `Switch failed: ${res.status} ${res.statusText}`);
      }
      setCurrentId(agent.id);
      setOpen(false); // Close dropdown after successful switch

      // Refresh agent list and current path to reflect the switch
      await loadAgents();

      // Add to recent agents
      addToRecentAgents(agent);

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
  }, [returnToWelcome, addToRecentAgents, loadAgents, router]);

  const handleInstall = useCallback(async (agentId: string) => {
    try {
      setSwitching(true);
      const res = await fetch(`${getApiUrl()}/api/agents/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Install failed: ${res.status}`);
      }
      // Reload agents list to get fresh data
      const freshData = await loadAgents();
      if (!freshData) {
        throw new Error('Failed to reload agents list after installation');
      }

      // Check if the agent exists in the freshly loaded installed list
      const agent = freshData.installed.find(a => a.id === agentId);
      if (!agent) {
        console.error(`Agent not found in fresh installed list: ${agentId}`);
        throw new Error(`Agent '${agentId}' not found after installation. Please refresh.`);
      }

      // After successful install, switch to the agent
      const switchRes = await fetch(`${getApiUrl()}/api/agents/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!switchRes.ok) {
        const errorData = await switchRes.json().catch(() => ({}));
        console.error(`Agent switch failed: ${JSON.stringify(errorData)}`);
        throw new Error(errorData.error || errorData.message || `Switch failed: ${switchRes.status} ${switchRes.statusText}`);
      }
      setCurrentId(agentId);
      setOpen(false);
      try {
        window.dispatchEvent(
          new CustomEvent('dexto:agentSwitched', {
            detail: { id: agentId, name: agent.name },
          })
        );
      } catch {}
      returnToWelcome();
    } catch (err) {
      console.error(`Install agent failed: ${err instanceof Error ? err.message : String(err)}`);
      const errorMessage = err instanceof Error ? err.message : 'Failed to install agent';
      alert(`Failed to install agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [loadAgents, returnToWelcome]);

  const handleDelete = useCallback(async (agent: AgentItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering switch when clicking delete
    if (!confirm(`Are you sure you want to delete the custom agent "${agent.name}"?`)) {
      return;
    }
    try {
      setSwitching(true);
      const res = await fetch(`${getApiUrl()}/api/agents/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed: ${res.status}`);
      }
      const updated = await loadAgents();
      // If the backend still reports the deleted id as current, clear it locally
      if (updated?.current.id === agent.id) {
        setCurrentId(null);
      }
    } catch (err) {
      console.error(`Delete agent failed: ${err instanceof Error ? err.message : String(err)}`);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete agent';
      alert(`Failed to delete agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [currentId, loadAgents]);

  const handleAgentCreated = useCallback(async (_agentName: string) => {
    // Add a small delay to ensure the agent is fully installed
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Reload agents list to show the newly created agent
    await loadAgents();
    // Note: We don't automatically switch to the newly created agent to avoid race conditions
    // The user can manually switch to it from the dropdown
  }, [loadAgents]);

  const currentLabel = useMemo(() => {
    if (!currentId) return 'Choose Agent';
    const match = installed.find(agent => agent.id === currentId) || available.find(agent => agent.id === currentId);
    return match?.name ?? currentId;
  }, [available, currentId, installed]);

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
