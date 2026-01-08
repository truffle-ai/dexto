import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys.js';
import { cn } from '@/lib/utils';
import {
    useAgents,
    useAgentPath,
    useSwitchAgent,
    useInstallAgent,
    useUninstallAgent,
} from '../hooks/useAgents';
import { useRecentAgentsStore } from '@/lib/stores/recentAgentsStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { Button } from '../ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
    ChevronDown,
    Check,
    DownloadCloud,
    Sparkles,
    Trash2,
    BadgeCheck,
    Plus,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
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

type AgentSelectorProps = {
    mode?: 'default' | 'badge' | 'title';
};

export default function AgentSelector({ mode = 'default' }: AgentSelectorProps) {
    const navigate = useNavigate();
    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    const recentAgents = useRecentAgentsStore((state) => state.recentAgents);
    const addToRecentAgents = useRecentAgentsStore((state) => state.addRecentAgent);

    const [switching, setSwitching] = useState(false);
    const [open, setOpen] = useState(false);
    const [createModalOpen, setCreateModalOpen] = useState(false);

    // Keep analytics ref up to date to avoid stale closure issues
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    const queryClient = useQueryClient();

    // Invalidate all agent-specific queries when switching agents
    // This replaces the DOM event pattern (dexto:agentSwitched)
    const invalidateAgentSpecificQueries = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        queryClient.invalidateQueries({ queryKey: ['sessions', 'history'] }); // All session histories
        queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
        queryClient.invalidateQueries({ queryKey: ['servers', 'tools'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        queryClient.invalidateQueries({ queryKey: ['greeting'] }); // Hierarchical invalidation
        queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.config }); // Agent config (CustomizePanel)
    }, [queryClient]);

    // Check if an agent path is from the global ~/.dexto directory
    // Global pattern: /Users/<user>/.dexto/agents or /home/<user>/.dexto/agents
    // Also handles Windows: C:\Users\<user>\.dexto\agents
    const isGlobalAgent = useCallback((path: string): boolean => {
        // Match paths where .dexto appears within first 4 segments (home directory level)
        // POSIX: /Users/username/.dexto/agents/... (index 2)
        // Windows: C:/Users/username/.dexto/agents/... (index 3, drive letter adds extra segment)
        // Project: /Users/username/Projects/my-project/.dexto/agents/... (5+ segments)
        // Normalize Windows backslashes to forward slashes for consistent parsing
        const normalized = path.replace(/\\/g, '/');
        const segments = normalized.split('/').filter(Boolean);
        const dextoIndex = segments.findIndex((s) => s === '.dexto');
        return dextoIndex >= 0 && dextoIndex <= 3;
    }, []);

    // Fetch agents list and path using typed hooks
    const { data: agentsData, isLoading: agentsLoading, refetch: refetchAgents } = useAgents();
    const { data: currentAgentPathData } = useAgentPath();

    const installed = useMemo(() => agentsData?.installed || [], [agentsData?.installed]);
    const available = useMemo(() => agentsData?.available || [], [agentsData?.available]);
    const currentId = agentsData?.current.id || null;
    const currentAgentPath = currentAgentPathData ?? null;

    // Agent mutations using typed hooks
    const switchAgentMutation = useSwitchAgent();
    const installAgentMutation = useInstallAgent();
    const deleteAgentMutation = useUninstallAgent();

    // Sync current agent path to recent agents when it loads
    useEffect(() => {
        if (currentAgentPath?.path && currentAgentPath?.name) {
            addToRecentAgents({
                id: currentAgentPath.name,
                name: currentAgentPath.name,
                path: currentAgentPath.path,
            });
        }
    }, [currentAgentPath, addToRecentAgents]);

    const loading = agentsLoading;

    const handleSwitch = useCallback(
        async (agentId: string) => {
            try {
                setSwitching(true);
                // Check if the agent exists in the installed list
                const agent = installed.find((agent) => agent.id === agentId);
                if (!agent) {
                    console.error(`Agent not found in installed list: ${agentId}`);
                    throw new Error(
                        `Agent '${agentId}' not found. Please refresh the agents list.`
                    );
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

                // Invalidate all agent-specific queries
                invalidateAgentSpecificQueries();

                // Navigate back to home after switching agents
                // The ChatApp component will automatically handle returnToWelcome when sessionId prop is undefined
                navigate({ to: '/' });
            } catch (err) {
                console.error(
                    `Switch agent failed: ${err instanceof Error ? err.message : String(err)}`
                );
                const errorMessage = err instanceof Error ? err.message : 'Failed to switch agent';
                alert(`Failed to switch agent: ${errorMessage}`);
            } finally {
                setSwitching(false);
            }
        },
        [
            installed,
            navigate,
            currentId,
            currentSessionId,
            switchAgentMutation,
            invalidateAgentSpecificQueries,
        ]
    );

    const handleSwitchToPath = useCallback(
        async (agent: { id: string; name: string; path: string }) => {
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

                // Invalidate all agent-specific queries
                invalidateAgentSpecificQueries();

                // Navigate back to home after switching agents
                // The ChatApp component will automatically handle returnToWelcome when sessionId prop is undefined
                navigate({ to: '/' });
            } catch (err) {
                console.error(
                    `Switch agent failed: ${err instanceof Error ? err.message : String(err)}`
                );
                const errorMessage = err instanceof Error ? err.message : 'Failed to switch agent';
                alert(`Failed to switch agent: ${errorMessage}`);
            } finally {
                setSwitching(false);
            }
        },
        [
            addToRecentAgents,
            navigate,
            currentId,
            currentSessionId,
            switchAgentMutation,
            invalidateAgentSpecificQueries,
        ]
    );

    const handleInstall = useCallback(
        async (agentId: string) => {
            try {
                setSwitching(true);

                // Capture current agent ID before operations
                const fromAgentId = currentId;

                // Step 1: Install the agent
                await installAgentMutation.mutateAsync({ id: agentId });

                // Step 2: Refetch agents list to ensure cache has fresh data
                await queryClient.refetchQueries({ queryKey: queryKeys.agents.all });

                // Step 3: Verify agent is now in installed list
                const freshData = queryClient.getQueryData<AgentsResponse>(queryKeys.agents.all);
                const agent = freshData?.installed.find((a) => a.id === agentId);
                if (!agent) {
                    throw new Error(
                        `Agent '${agentId}' not found after installation. Please refresh.`
                    );
                }

                // Step 4: Switch to the newly installed agent
                await switchAgentMutation.mutateAsync({ id: agentId });

                setOpen(false);

                // Step 5: Track the switch analytics
                analyticsRef.current.trackAgentSwitched({
                    fromAgentId,
                    toAgentId: agentId,
                    toAgentName: agent.name,
                    sessionId: currentSessionId || undefined,
                });

                // Step 6: Invalidate all agent-specific queries
                invalidateAgentSpecificQueries();

                // Step 7: Navigate to home
                // The ChatApp component will automatically handle returnToWelcome when sessionId prop is undefined
                navigate({ to: '/' });
            } catch (err) {
                console.error(
                    `Install/switch agent failed: ${err instanceof Error ? err.message : String(err)}`
                );
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to install/switch agent';
                alert(`Failed to install/switch agent: ${errorMessage}`);
            } finally {
                setSwitching(false);
            }
        },
        [
            navigate,
            currentId,
            currentSessionId,
            queryClient,
            installAgentMutation,
            switchAgentMutation,
            invalidateAgentSpecificQueries,
        ]
    );

    const handleDelete = useCallback(
        async (agent: AgentItem, e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent triggering switch when clicking delete
            if (!confirm(`Are you sure you want to delete the custom agent "${agent.name}"?`)) {
                return;
            }
            try {
                setSwitching(true);
                await deleteAgentMutation.mutateAsync({ id: agent.id });
            } catch (err) {
                console.error(
                    `Delete agent failed: ${err instanceof Error ? err.message : String(err)}`
                );
                const errorMessage = err instanceof Error ? err.message : 'Failed to delete agent';
                alert(`Failed to delete agent: ${errorMessage}`);
            } finally {
                setSwitching(false);
            }
        },
        [deleteAgentMutation]
    );

    const currentLabel = useMemo(() => {
        if (!currentId) return 'Choose Agent';
        const match =
            installed.find((agent) => agent.id === currentId) ||
            available.find((agent) => agent.id === currentId);
        return match?.name ?? currentId;
    }, [available, currentId, installed]);

    const handleAgentCreated = useCallback(
        async (_agentName: string) => {
            await refetchAgents();
        },
        [refetchAgents]
    );

    const getButtonClassName = (mode: string) => {
        switch (mode) {
            case 'badge':
                // Teal text, transparent bg
                return `h-9 px-4 text-lg font-medium rounded-lg bg-transparent text-teal-600 hover:bg-muted/50 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 transition-colors min-w-[120px] max-w-[180px] md:min-w-[160px] md:max-w-[280px] lg:max-w-[400px] xl:max-w-[500px]`;
            case 'title':
                return `h-11 px-4 text-lg font-bold rounded-lg bg-gradient-to-r from-teal-500/30 to-teal-500/40 text-teal-600 hover:from-teal-500/50 hover:to-teal-500/60 hover:text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2 border border-teal-500/40 dark:text-teal-400 dark:hover:text-teal-300 dark:border-teal-400 transition-all duration-200 shadow-lg hover:shadow-xl`;
            default:
                return `h-10 px-3 text-sm rounded-lg bg-teal-500/40 text-teal-600 hover:bg-teal-500/50 hover:text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-2 border border-teal-500/50 dark:text-teal-400 dark:hover:text-teal-300 dark:border-teal-400 transition-all duration-200 shadow-lg hover:shadow-xl`;
        }
    };

    return (
        <>
            <DropdownMenu open={open} onOpenChange={setOpen}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant={mode === 'badge' ? 'ghost' : 'default'}
                                size="sm"
                                className={getButtonClassName(mode)}
                                disabled={switching}
                            >
                                <div className="flex items-center justify-between w-full min-w-0">
                                    {mode !== 'badge' && (
                                        <Sparkles className="w-4 h-4 mr-2 flex-shrink-0" />
                                    )}
                                    <span
                                        className={cn(
                                            'truncate min-w-0',
                                            mode === 'badge'
                                                ? 'flex-1 text-left'
                                                : 'flex-1 text-center px-1'
                                        )}
                                    >
                                        {switching
                                            ? 'Switching...'
                                            : mode === 'title'
                                              ? `Agent: ${currentLabel}`
                                              : currentLabel}
                                    </span>
                                    <ChevronDown className="w-4 h-4 ml-1.5 flex-shrink-0 opacity-60" />
                                </div>
                            </Button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Select agent</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                    align="start"
                    className="w-80 max-h-96 overflow-y-auto shadow-xl border-border/30"
                >
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
                                className="cursor-pointer py-3 px-3 mx-1 my-1 bg-gradient-to-r from-primary/10 to-primary/5 hover:from-primary/15 hover:to-primary/10 border border-primary/20 hover:border-primary/30 transition-all rounded-md shadow-sm"
                            >
                                <div className="flex items-center gap-2 w-full">
                                    <Plus className="w-4 h-4 text-primary" />
                                    <span className="font-semibold text-primary">New Agent</span>
                                </div>
                            </DropdownMenuItem>

                            {/* Current Agent (if loaded from file and not in installed list) */}
                            {currentAgentPath &&
                                !installed.some((a) => a.id === currentAgentPath.name) && (
                                    <>
                                        <div className="px-3 py-2 mt-1 text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider border-b border-border/20">
                                            Currently Active
                                        </div>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                handleSwitchToPath({
                                                    id: currentAgentPath.name,
                                                    name: currentAgentPath.name,
                                                    path: currentAgentPath.path,
                                                })
                                            }
                                            disabled={
                                                switching || currentId === currentAgentPath.name
                                            }
                                            className="cursor-pointer py-3 px-3 hover:bg-muted/60 transition-colors rounded-md mx-1"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-sm truncate">
                                                            {currentAgentPath.name}
                                                        </span>
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
                                    <div className="px-3 py-2 mt-1 text-xs font-bold text-foreground/70 uppercase tracking-wider border-b border-border/20">
                                        Recent
                                    </div>
                                    {recentAgents
                                        .filter(
                                            (ra) =>
                                                !installed.some((a) => a.id === ra.id) &&
                                                ra.id !== currentAgentPath?.name &&
                                                !isGlobalAgent(ra.path) // Filter out global dexto directory agents
                                        )
                                        .slice(0, 3)
                                        .map((agent) => (
                                            <DropdownMenuItem
                                                key={agent.path}
                                                onClick={() => handleSwitchToPath(agent)}
                                                disabled={switching || agent.id === currentId}
                                                className="cursor-pointer py-3 px-3 hover:bg-muted/60 transition-colors rounded-md mx-1"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm truncate">
                                                                {agent.name}
                                                            </span>
                                                            {agent.id === currentId && (
                                                                <Check className="w-4 h-4 text-green-600 flex-shrink-0 animate-in fade-in duration-200" />
                                                            )}
                                                        </div>
                                                        <p
                                                            className="text-xs text-muted-foreground mt-0.5 truncate"
                                                            title={agent.path}
                                                        >
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
                                    <div className="px-3 py-2 mt-1 text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1 border-b border-border/20">
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
                                                className="cursor-pointer py-3 px-3 hover:bg-muted/60 transition-colors rounded-md mx-1"
                                            >
                                                <div className="flex items-center justify-between w-full gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm truncate">
                                                                {agent.name}
                                                            </span>
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
                                    {installed.filter((a) => a.type === 'custom').length > 0 && (
                                        <DropdownMenuSeparator />
                                    )}
                                    <div className="px-3 py-2 mt-1 text-xs font-bold text-foreground/70 uppercase tracking-wider border-b border-border/20">
                                        Installed
                                    </div>
                                    {installed
                                        .filter((a) => a.type === 'builtin')
                                        .map((agent) => (
                                            <DropdownMenuItem
                                                key={agent.id}
                                                onClick={() => handleSwitch(agent.id)}
                                                disabled={switching || agent.id === currentId}
                                                className="cursor-pointer py-3 px-3 hover:bg-muted/60 transition-colors rounded-md mx-1"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm truncate">
                                                                {agent.name}
                                                            </span>
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
                                    <div className="px-3 py-2 mt-1 text-xs font-bold text-foreground/70 uppercase tracking-wider border-b border-border/20">
                                        Available
                                    </div>
                                    {available
                                        .filter((a) => a.type === 'builtin')
                                        .map((agent) => (
                                            <DropdownMenuItem
                                                key={agent.id}
                                                onClick={() => handleInstall(agent.id)}
                                                disabled={switching}
                                                className="cursor-pointer py-3 px-3 hover:bg-muted/60 transition-colors rounded-md mx-1"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm truncate">
                                                                {agent.name}
                                                            </span>
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
                                <DropdownMenuItem
                                    disabled
                                    className="text-center text-muted-foreground"
                                >
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
