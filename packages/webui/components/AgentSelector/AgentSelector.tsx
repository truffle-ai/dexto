'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  current?: { id?: string | null; name?: string | null };
};

type AgentSelectorProps = {
  mode?: 'default' | 'badge' | 'title';
};

export default function AgentSelector({ mode = 'default' }: AgentSelectorProps) {
  const { returnToWelcome } = useChatContext();

  const [installed, setInstalled] = useState<AgentItem[]>([]);
  const [available, setAvailable] = useState<AgentItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data: AgentsResponse = await res.json();
      setInstalled(data.installed || []);
      setAvailable(data.available || []);
      setCurrentId(data.current?.id ?? data.current?.name ?? null);
    } catch (err) {
      console.error('AgentSelector load error:', err);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadAgents().finally(() => setLoading(false));
  }, [loadAgents]);

  const handleSwitch = useCallback(async (agentId: string) => {
    try {
      setSwitching(true);
      // Check if the agent exists in the installed list
      const agent = installed.find(agent => agent.id === agentId);
      if (!agent) {
        console.error('Agent not found in installed list:', agentId);
        throw new Error(`Agent '${agentId}' not found. Please refresh the agents list.`);
      }
      
      const res = await fetch('/api/agents/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('Agent switch failed:', errorData);
        throw new Error(errorData.error || errorData.message || `Switch failed: ${res.status} ${res.statusText}`);
      }
      setCurrentId(agentId);
      setOpen(false); // Close dropdown after successful switch
      try {
        window.dispatchEvent(
          new CustomEvent('dexto:agentSwitched', {
            detail: { id: agentId, name: agent.name },
          })
        );
      } catch {}
      returnToWelcome();
    } catch (err) {
      console.error('Switch agent failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to switch agent';
      alert(`Failed to switch agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [returnToWelcome, installed]);

  const handleInstall = useCallback(async (agentId: string) => {
    try {
      setSwitching(true);
      const res = await fetch('/api/agents/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Install failed: ${res.status}`);
      }
      // Reload agents list to reflect the newly installed agent
      await loadAgents();
      // After successful install, switch to the agent
      await handleSwitch(agentId);
    } catch (err) {
      console.error('Install agent failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to install agent';
      alert(`Failed to install agent: ${errorMessage}`);
      setSwitching(false);
    }
  }, [handleSwitch, loadAgents]);

  const handleDelete = useCallback(async (agent: AgentItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering switch when clicking delete
    if (!confirm(`Are you sure you want to delete the custom agent "${agent.name}"?`)) {
      return;
    }
    try {
      setSwitching(true);
      const res = await fetch('/api/agents/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed: ${res.status}`);
      }
      await loadAgents();
      // If we deleted the current agent, clear current
      if (currentId === agent.id) {
        setCurrentId(null);
      }
    } catch (err) {
      console.error('Delete agent failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete agent';
      alert(`Failed to delete agent: ${errorMessage}`);
    } finally {
      setSwitching(false);
    }
  }, [currentId, loadAgents]);

  const handleAgentCreated = useCallback(async (agentName: string) => {
    // Add a small delay to ensure the agent is fully installed
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Reload agents list to show the newly created agent
    await loadAgents();
    // Note: We don't automatically switch to the newly created agent to avoid race conditions
    // The user can manually switch to it from the dropdown
  }, [loadAgents]);

  const fallbackAgentName = useCallback((id: string) => (
    id
      .split('-')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  ), []);

  const currentLabel = useMemo(() => {
    if (!currentId) return 'Choose Agent';
    const match = installed.find(agent => agent.id === currentId) || available.find(agent => agent.id === currentId);
    return match?.name ?? fallbackAgentName(currentId);
  }, [available, currentId, fallbackAgentName, installed]);

  const getButtonClassName = (mode: string) => {
    const baseClasses = 'transition-all duration-200 shadow-lg hover:shadow-xl font-semibold rounded-full';
    
    switch (mode) {
      case 'badge':
        return `h-9 px-3 text-xs border border-teal-500 bg-teal-500/20 text-teal-600 hover:bg-teal-500/40 hover:border-teal-500 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 dark:border-teal-400 dark:hover:border-teal-300 ${baseClasses}`;
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
          <Sparkles className="w-4 h-4 mr-2" />
          {switching ? 'Switching...' : mode === 'title' ? `Agent: ${currentLabel}` : currentLabel}
          <ChevronDown className="w-4 h-4 ml-2" />
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
