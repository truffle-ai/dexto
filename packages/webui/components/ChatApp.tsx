import React, { useState, useCallback, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate } from '@tanstack/react-router';
import { useChatContext } from './hooks/ChatContext';
import { useTheme } from './hooks/useTheme';
import { usePrompts } from './hooks/usePrompts';
import { useDeleteSession } from './hooks/useSessions';
import { client } from '@/lib/client';
import { useAddServer } from './hooks/useServers';
import { useResolvePrompt } from './hooks/usePrompts';
import {
    useChatStore,
    useCurrentSessionId,
    useIsWelcomeState,
    useAllMessages,
    useSessionProcessing,
    useSessionError,
    useCurrentToolName,
} from '@/lib/stores';
import { useGreeting } from './hooks/useGreeting';
import MessageList from './MessageList';
import InputArea from './InputArea';
import ConnectServerModal from './ConnectServerModal';
import ServerRegistryModal from './ServerRegistryModal';
import ServersPanel from './ServersPanel';
import SessionPanel from './SessionPanel';
import MemoryPanel from './MemoryPanel';
import { ToolConfirmationHandler, type ApprovalEvent } from './ToolConfirmationHandler';
import GlobalSearchModal from './GlobalSearchModal';
import CustomizePanel from './AgentEditor/CustomizePanel';
import { Button } from './ui/button';
import {
    Server,
    Download,
    Wrench,
    Keyboard,
    AlertTriangle,
    MoreHorizontal,
    Menu,
    Trash2,
    Settings,
    ChevronDown,
    FlaskConical,
    Check,
    FileEditIcon,
    Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { SettingsPanel } from './settings/SettingsPanel';
import AgentSelector from './AgentSelector/AgentSelector';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { serverRegistry } from '@/lib/serverRegistry';
import { buildConfigFromRegistryEntry, hasEmptyOrPlaceholderValue } from '@/lib/serverConfig';
import type { McpServerConfig } from '@dexto/core';
import type { ServerRegistryEntry } from '@dexto/registry';

interface ChatAppProps {
    sessionId?: string;
}

export default function ChatApp({ sessionId }: ChatAppProps = {}) {
    const navigate = useNavigate();

    // Get state from Zustand stores using centralized selectors
    const currentSessionId = useCurrentSessionId();
    const isWelcomeState = useIsWelcomeState();
    const messages = useAllMessages(currentSessionId);
    const processing = useSessionProcessing(currentSessionId);
    const activeError = useSessionError(currentSessionId);
    const currentToolName = useCurrentToolName();

    // Get actions from ChatContext
    const { sendMessage, switchSession, returnToWelcome, cancel } = useChatContext();

    // Get greeting from API
    const { greeting } = useGreeting(currentSessionId);

    // clearError now managed via chatStore
    const clearError = useCallback(() => {
        if (currentSessionId) {
            useChatStore.getState().setError(currentSessionId, null);
        }
    }, [currentSessionId]);

    // Theme management
    const { theme, toggleTheme } = useTheme();

    // API mutations
    const { mutateAsync: addServer } = useAddServer();
    const { mutateAsync: resolvePrompt } = useResolvePrompt();

    const [isModalOpen, setModalOpen] = useState(false);
    const [isServerRegistryOpen, setServerRegistryOpen] = useState(false);
    const [isServersPanelOpen, setServersPanelOpen] = useState(false);
    const [isSessionsPanelOpen, setSessionsPanelOpen] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const isFirstRenderRef = React.useRef(true);
    const [isSearchOpen, setSearchOpen] = useState(false);
    const [isExportOpen, setExportOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [isCustomizePanelOpen, setCustomizePanelOpen] = useState(false);
    const [isMemoryPanelOpen, setMemoryPanelOpen] = useState(false);
    const [exportName, setExportName] = useState('dexto-config');
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportContent, setExportContent] = useState<string>('');
    const [copySuccess, setCopySuccess] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Enhanced features
    const [isSendingMessage, setIsSendingMessage] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Conversation management states
    const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);

    // Approval state (for inline rendering in message stream)
    const [pendingApproval, setPendingApproval] = useState<ApprovalEvent | null>(null);
    const [approvalHandlers, setApprovalHandlers] = useState<{
        onApprove: (formData?: Record<string, any>, rememberChoice?: boolean) => void;
        onDeny: () => void;
    } | null>(null);

    const deleteSessionMutation = useDeleteSession();

    // Fetch starter prompts using shared usePrompts hook
    const { data: promptsData = [], isLoading: promptsLoading } = usePrompts({
        enabled: isWelcomeState,
    });

    // Filter prompts with showInStarters metadata flag
    const starterPrompts = promptsData.filter((prompt) => prompt.metadata?.showInStarters === true);
    const starterPromptsLoaded = !promptsLoading;

    // Note: Agent switch invalidation is now handled centrally in AgentSelector

    // Scroll management for robust autoscroll
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const listContentRef = React.useRef<HTMLDivElement | null>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [isScrollingToBottom, setIsScrollingToBottom] = useState(false);
    const [followStreaming, setFollowStreaming] = useState(false);
    const lastScrollTopRef = React.useRef(0);
    // Improved "Scroll to bottom" hint
    const [showScrollHint, setShowScrollHint] = useState(false);
    const scrollIdleTimerRef = React.useRef<number | null>(null);

    // Server refresh trigger
    const [serversRefreshTrigger, setServersRefreshTrigger] = useState(0);
    // Prefill config for ConnectServerModal
    const [connectPrefill, setConnectPrefill] = useState<{
        name: string;
        config: Partial<McpServerConfig> & { type?: 'stdio' | 'sse' | 'http' };
        lockName?: boolean;
        registryEntryId?: string;
        onCloseRegistryModal?: () => void;
    } | null>(null);
    const [isRegistryBusy, setIsRegistryBusy] = useState(false);

    useEffect(() => {
        const updateViewportHeight = () => {
            if (typeof document === 'undefined') return;
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            document.documentElement.style.setProperty(
                '--app-viewport-height',
                `${viewportHeight}px`
            );
        };

        updateViewportHeight();
        window.addEventListener('resize', updateViewportHeight);
        window.addEventListener('orientationchange', updateViewportHeight);
        window.visualViewport?.addEventListener('resize', updateViewportHeight);

        return () => {
            window.removeEventListener('resize', updateViewportHeight);
            window.removeEventListener('orientationchange', updateViewportHeight);
            window.visualViewport?.removeEventListener('resize', updateViewportHeight);
        };
    }, []);

    const recomputeIsAtBottom = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1;
        setIsAtBottom(nearBottom);
    }, []);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        const el = scrollContainerRef.current;
        if (!el) return;
        setIsScrollingToBottom(true);
        el.scrollTo({ top: el.scrollHeight, behavior });
        // Release the lock on next frame to allow ResizeObserver to settle
        requestAnimationFrame(() => setIsScrollingToBottom(false));
    }, []);

    // Observe user scroll position
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const onScroll = () => {
            // When user scrolls up, disable followStreaming
            const prev = lastScrollTopRef.current;
            const curr = el.scrollTop;
            if (!isScrollingToBottom && followStreaming && curr < prev) {
                setFollowStreaming(false);
            }
            lastScrollTopRef.current = curr;
            recomputeIsAtBottom();

            // Debounced hint: show when not at bottom after scrolling stops
            const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1;
            if (nearBottom) {
                setShowScrollHint(false);
                if (scrollIdleTimerRef.current) {
                    window.clearTimeout(scrollIdleTimerRef.current);
                    scrollIdleTimerRef.current = null;
                }
            } else {
                setShowScrollHint(false);
                if (scrollIdleTimerRef.current) window.clearTimeout(scrollIdleTimerRef.current);
                scrollIdleTimerRef.current = window.setTimeout(() => {
                    setShowScrollHint(true);
                }, 180);
            }
        };
        el.addEventListener('scroll', onScroll);
        // Initial compute in case of restored sessions
        recomputeIsAtBottom();
        return () => el.removeEventListener('scroll', onScroll);
    }, [recomputeIsAtBottom, followStreaming, isScrollingToBottom, isWelcomeState]);

    // Content resize observer to autoscroll on content growth
    useEffect(() => {
        const content = listContentRef.current;
        if (!content) return;
        const ro = new ResizeObserver(() => {
            if (isScrollingToBottom) return;
            if (followStreaming || isAtBottom) scrollToBottom('auto');
        });
        ro.observe(content);
        return () => ro.disconnect();
    }, [isAtBottom, isScrollingToBottom, followStreaming, scrollToBottom, isWelcomeState]);

    // Fallback: if messages change during streaming, ensure we keep following
    useEffect(() => {
        if (followStreaming) scrollToBottom('auto');
    }, [followStreaming, messages, scrollToBottom]);

    // Position the last user message near the top then follow streaming
    const positionLastUserNearTop = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const nodes = container.querySelectorAll('[data-role="user"]');
        const el = nodes[nodes.length - 1] as HTMLElement | undefined;
        if (!el) {
            // Fallback to bottom
            scrollToBottom('auto');
            return;
        }
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const offsetTop = eRect.top - cRect.top + container.scrollTop;
        const target = Math.max(offsetTop - 16, 0);
        setIsScrollingToBottom(true);
        container.scrollTo({ top: target, behavior: 'auto' });
        requestAnimationFrame(() => setIsScrollingToBottom(false));
    }, [scrollToBottom]);

    useEffect(() => {
        if (isExportOpen) {
            // Fetch YAML configuration for preview
            const fetchConfig = async () => {
                try {
                    const response = await client.api.agent.config.export.$get({
                        query: currentSessionId ? { sessionId: currentSessionId } : {},
                    });
                    if (!response.ok) {
                        throw new Error('Failed to fetch configuration');
                    }
                    const text = await response.text();
                    setExportContent(text);
                    setExportError(null);
                } catch (err) {
                    console.error('Preview fetch failed:', err);
                    setExportError(err instanceof Error ? err.message : 'Preview fetch failed');
                }
            };
            void fetchConfig();
        } else {
            setExportContent('');
            setExportError(null);
            setCopySuccess(false);
        }
    }, [isExportOpen, currentSessionId]);

    const handleDownload = useCallback(async () => {
        try {
            const response = await client.api.agent.config.export.$get({
                query: currentSessionId ? { sessionId: currentSessionId } : {},
            });
            if (!response.ok) {
                throw new Error('Failed to fetch configuration');
            }
            const yamlText = await response.text();
            const blob = new Blob([yamlText], { type: 'application/x-yaml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;

            const fileName = currentSessionId
                ? `${exportName}-${currentSessionId}.yml`
                : `${exportName}.yml`;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            setExportError(error instanceof Error ? error.message : 'Download failed');
        }
    }, [exportName, currentSessionId]);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(exportContent);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            setExportError('Failed to copy to clipboard');
        }
    }, [exportContent]);

    const handleSend = useCallback(
        async (content: string, imageData?: any, fileData?: any) => {
            setIsSendingMessage(true);
            setErrorMessage(null);

            try {
                await sendMessage(content, imageData, fileData);
                // After sending, position the new user message near the top,
                // then enable followStreaming to follow the assistant reply.
                setTimeout(() => {
                    positionLastUserNearTop();
                    setFollowStreaming(true);
                }, 0);
            } catch (error) {
                console.error('Failed to send message:', error);
                setErrorMessage(error instanceof Error ? error.message : 'Failed to send message');
                setTimeout(() => setErrorMessage(null), 5000);
            } finally {
                setIsSendingMessage(false);
            }
        },
        [sendMessage, positionLastUserNearTop]
    );

    // Toggle followStreaming based on processing state (replaces DOM events)
    useEffect(() => {
        setFollowStreaming(processing);
    }, [processing]);

    const handleSessionChange = useCallback(
        (sessionId: string) => {
            // Reset scroll state when changing sessions
            setFollowStreaming(false);
            setShowScrollHint(false);
            // Navigate to the session URL instead of just switching in context
            navigate({ to: `/chat/${sessionId}` });
            // Keep the sessions panel open when switching sessions
        },
        [navigate]
    );

    const handleReturnToWelcome = useCallback(() => {
        // Reset scroll state when returning to welcome
        setFollowStreaming(false);
        setShowScrollHint(false);
        // Clear the context state first, then navigate to home page
        returnToWelcome();
        navigate({ to: '/' });
    }, [navigate, returnToWelcome]);

    // Handle hydration and restore localStorage state
    useEffect(() => {
        setIsHydrated(true);
        // Restore sessions panel state from localStorage after hydration
        const savedPanelState = localStorage.getItem('sessionsPanelOpen');
        if (savedPanelState === 'true') {
            setSessionsPanelOpen(true);
        }
        // Mark first render as complete to enable transitions
        setTimeout(() => {
            isFirstRenderRef.current = false;
        }, 0);
    }, []);

    // Persist sessions panel state to localStorage
    useEffect(() => {
        if (isHydrated && typeof window !== 'undefined') {
            localStorage.setItem('sessionsPanelOpen', isSessionsPanelOpen.toString());
        }
    }, [isSessionsPanelOpen, isHydrated]);

    // Handle sessionId prop from URL - for loading specific sessions
    useEffect(() => {
        if (sessionId && sessionId !== currentSessionId) {
            // Reset scroll state when switching sessions
            setFollowStreaming(false);
            setShowScrollHint(false);
            switchSession(sessionId);
        }
    }, [sessionId, currentSessionId, switchSession]);

    // Ensure welcome state on home page (when no sessionId prop)
    useEffect(() => {
        if (!sessionId && !isWelcomeState) {
            // We're on the home page but not in welcome state - reset to welcome
            returnToWelcome();
        }
    }, [sessionId, isWelcomeState, returnToWelcome]);

    type InstallableRegistryEntry = ServerRegistryEntry & {
        onCloseRegistryModal?: () => void;
    };

    const handleInstallServer = useCallback(
        async (entry: InstallableRegistryEntry): Promise<'connected' | 'requires-input'> => {
            const config = buildConfigFromRegistryEntry(entry);

            const needsEnvInput =
                config.type === 'stdio' &&
                Object.keys(config.env || {}).length > 0 &&
                hasEmptyOrPlaceholderValue(config.env || {});
            const needsHeaderInput =
                (config.type === 'sse' || config.type === 'http') &&
                'headers' in config &&
                Object.keys(config.headers || {}).length > 0 &&
                hasEmptyOrPlaceholderValue(config.headers || {});

            // If inputs needed, open modal but keep registry open
            if (needsEnvInput || needsHeaderInput) {
                setConnectPrefill({
                    name: entry.name,
                    config,
                    lockName: true,
                    registryEntryId: entry.id,
                    onCloseRegistryModal:
                        entry.onCloseRegistryModal ?? (() => setServerRegistryOpen(false)),
                });
                setModalOpen(true);
                return 'requires-input';
            }

            try {
                setIsRegistryBusy(true);
                await addServer({
                    name: entry.name,
                    config,
                    persistToAgent: false,
                });

                if (entry.id) {
                    try {
                        await serverRegistry.setInstalled(entry.id, true);
                    } catch (e) {
                        console.warn('Failed to mark registry entry installed:', e);
                    }
                }

                setServersRefreshTrigger((prev) => prev + 1);
                setSuccessMessage(`Added ${entry.name}`);
                setTimeout(() => setSuccessMessage(null), 4000);
                setServerRegistryOpen(false);
                return 'connected';
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to install server';
                throw new Error(message);
            } finally {
                setIsRegistryBusy(false);
            }
        },
        [
            addServer,
            setServerRegistryOpen,
            setModalOpen,
            setConnectPrefill,
            setServersRefreshTrigger,
            setSuccessMessage,
            setIsRegistryBusy,
        ]
    );

    // Helper to check if viewport is narrow (for panel exclusivity)
    const isNarrowViewport = () => {
        return typeof window !== 'undefined' && window.innerWidth < 768;
    };

    // Smart panel handlers with exclusivity on narrow screens
    const handleOpenSessionsPanel = useCallback(() => {
        if (isNarrowViewport() && isServersPanelOpen) {
            setServersPanelOpen(false); // Close tools panel if open
        }
        setSessionsPanelOpen(!isSessionsPanelOpen);
    }, [isSessionsPanelOpen, isServersPanelOpen]);

    const handleOpenServersPanel = useCallback(() => {
        if (isNarrowViewport() && isSessionsPanelOpen) {
            setSessionsPanelOpen(false); // Close sessions panel if open
        }
        setServersPanelOpen(!isServersPanelOpen);
    }, [isServersPanelOpen, isSessionsPanelOpen]);

    const handleDeleteConversation = useCallback(async () => {
        if (!currentSessionId) return;

        try {
            await deleteSessionMutation.mutateAsync({ sessionId: currentSessionId });
            setDeleteDialogOpen(false);
            handleReturnToWelcome();
        } catch (error) {
            console.error('Failed to delete conversation:', error);
            setErrorMessage(
                error instanceof Error ? error.message : 'Failed to delete conversation'
            );
            setTimeout(() => setErrorMessage(null), 5000);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSessionId, handleReturnToWelcome]);

    // Memoize quick actions to prevent unnecessary recomputation
    const quickActions = React.useMemo(
        () => [
            {
                title: 'Help me get started',
                description: 'Show me what you can do',
                action: () =>
                    handleSend(
                        "I'm new to Dexto. Can you show me your capabilities and help me understand how to work with you effectively?"
                    ),
                icon: '🚀',
            },
            {
                title: 'Create Snake Game',
                description: 'Build a game and open it',
                action: () =>
                    handleSend(
                        'Create a snake game in a new directory with HTML, CSS, and JavaScript, then open it in the browser for me to play.'
                    ),
                icon: '🐍',
            },
            {
                title: 'Connect new tools',
                description: 'Browse and add MCP servers',
                action: () => setServersPanelOpen(true),
                icon: '🔧',
            },
            {
                title: 'Demonstrate tools',
                description: 'Show me your capabilities',
                action: () =>
                    handleSend(
                        'Pick one of your most interesting tools and demonstrate it with a practical example. Show me what it can do.'
                    ),
                icon: '⚡',
            },
        ],
        [handleSend, setServersPanelOpen]
    );

    // Merge dynamic quick actions from starter prompts
    const dynamicQuickActions = React.useMemo(() => {
        // Show default quick actions while loading
        if (!starterPromptsLoaded) {
            return quickActions.map((a) => ({
                description: `${a.icon} ${a.title}`,
                tooltip: a.description,
                action: a.action,
            }));
        }

        // If starter prompts are present, hide the built-in defaults to avoid duplication
        const actions: Array<{ description: string; tooltip?: string; action: () => void }> =
            starterPrompts.length > 0
                ? []
                : quickActions.map((a) => ({
                      description: `${a.icon} ${a.title}`,
                      tooltip: a.description,
                      action: a.action,
                  }));
        starterPrompts.forEach((prompt) => {
            const description = prompt.title || prompt.description || 'Starter prompt';
            const tooltip = prompt.description;

            if (prompt?.name === 'starter:connect-tools') {
                actions.push({
                    description,
                    tooltip,
                    action: () => setServersPanelOpen(true),
                });
            } else {
                // Starter prompts need to be resolved via API (metadata.prompt is stripped for security/performance)
                // This matches the resolution logic in InputArea for slash commands
                actions.push({
                    description,
                    tooltip,
                    action: async () => {
                        try {
                            // Resolve the prompt server-side just like InputArea does
                            const result = await resolvePrompt({
                                name: prompt.name,
                            });
                            if (result.text.trim()) {
                                handleSend(result.text.trim());
                            } else {
                                // Fallback: send slash command if resolution returned empty
                                handleSend(`/${prompt.name}`);
                            }
                        } catch (error) {
                            console.error(
                                `Failed to resolve starter prompt ${prompt.name}:`,
                                error
                            );
                            // Fallback: send slash command on error
                            handleSend(`/${prompt.name}`);
                        }
                    },
                });
            }
        });
        return actions;
    }, [
        starterPrompts,
        starterPromptsLoaded,
        quickActions,
        handleSend,
        setServersPanelOpen,
        resolvePrompt,
    ]);

    // Keyboard shortcuts (using react-hotkeys-hook)
    // Cmd/Ctrl + Backspace to delete current session
    useHotkeys(
        'mod+backspace',
        () => {
            if (currentSessionId && !isWelcomeState) {
                // If session has messages, show confirmation dialog
                if (messages.length > 0) {
                    setDeleteDialogOpen(true);
                } else {
                    // No messages, delete immediately
                    handleDeleteConversation();
                }
            }
        },
        { preventDefault: true },
        [currentSessionId, isWelcomeState, messages.length, handleDeleteConversation]
    );

    // Ctrl/Cmd + H to toggle sessions panel
    useHotkeys('mod+h', handleOpenSessionsPanel, { preventDefault: true }, [
        handleOpenSessionsPanel,
    ]);

    // Ctrl/Cmd + K to create new chat (return to welcome)
    useHotkeys('mod+k', handleReturnToWelcome, { preventDefault: true }, [handleReturnToWelcome]);

    // Ctrl/Cmd + J to toggle tools/servers panel
    useHotkeys('mod+j', handleOpenServersPanel, { preventDefault: true }, [handleOpenServersPanel]);

    // Ctrl/Cmd + M to toggle memory panel
    useHotkeys('mod+m', () => setMemoryPanelOpen((prev) => !prev), { preventDefault: true });

    // Ctrl/Cmd + Shift + S to open search
    useHotkeys('mod+shift+s', () => setSearchOpen(true), { preventDefault: true });

    // Ctrl/Cmd + L to open MCP playground
    useHotkeys('mod+l', () => window.open('/playground', '_blank'), { preventDefault: true });

    // Ctrl/Cmd + E to open customize panel
    useHotkeys('mod+e', () => setCustomizePanelOpen((prev) => !prev), { preventDefault: true });

    // Ctrl/Cmd + Shift + E to export config
    useHotkeys('mod+shift+e', () => setExportOpen(true), { preventDefault: true });

    // Ctrl/Cmd + / to show shortcuts
    useHotkeys('mod+slash', () => setShowShortcuts(true), { preventDefault: true });

    // Escape to close panels or cancel run
    useHotkeys(
        'escape',
        () => {
            if (isCustomizePanelOpen) setCustomizePanelOpen(false);
            else if (isServersPanelOpen) setServersPanelOpen(false);
            else if (isSessionsPanelOpen) setSessionsPanelOpen(false);
            else if (isMemoryPanelOpen) setMemoryPanelOpen(false);
            else if (isServerRegistryOpen) setServerRegistryOpen(false);
            else if (isExportOpen) setExportOpen(false);
            else if (showShortcuts) setShowShortcuts(false);
            else if (isDeleteDialogOpen) setDeleteDialogOpen(false);
            else if (errorMessage) setErrorMessage(null);
            else if (processing) cancel(currentSessionId || undefined);
        },
        [
            isCustomizePanelOpen,
            isServersPanelOpen,
            isSessionsPanelOpen,
            isMemoryPanelOpen,
            isServerRegistryOpen,
            isExportOpen,
            showShortcuts,
            isDeleteDialogOpen,
            errorMessage,
            processing,
            cancel,
            currentSessionId,
        ]
    );

    return (
        <div
            className="flex w-full bg-background"
            style={{
                height: 'var(--app-viewport-height, 100vh)',
                minHeight: 'var(--app-viewport-height, 100vh)',
            }}
        >
            {/* Left Sidebar - Chat History (Desktop only - inline) */}
            {/* Always visible: collapsed (thin bar) or expanded (full panel) */}
            <div
                className={cn(
                    'hidden md:block h-full shrink-0 bg-card/50 backdrop-blur-sm',
                    !isFirstRenderRef.current && 'transition-all duration-300 ease-in-out',
                    isSessionsPanelOpen ? 'w-72' : 'w-14'
                )}
                suppressHydrationWarning
            >
                <SessionPanel
                    isOpen={isSessionsPanelOpen}
                    onClose={() => setSessionsPanelOpen(false)}
                    onExpand={() => setSessionsPanelOpen(true)}
                    currentSessionId={currentSessionId}
                    onSessionChange={handleSessionChange}
                    returnToWelcome={handleReturnToWelcome}
                    variant="inline"
                    onSearchOpen={() => setSearchOpen(true)}
                    onNewChat={handleReturnToWelcome}
                    onSettingsOpen={() => setSettingsOpen(true)}
                    onPlaygroundOpen={() => window.open('/playground', '_blank')}
                    onThemeToggle={() => toggleTheme(theme === 'light')}
                    theme={theme}
                />
            </div>

            {/* Chat History Panel - Mobile/Narrow (overlay) */}
            <div className="md:hidden">
                <SessionPanel
                    isOpen={isSessionsPanelOpen}
                    onClose={() => setSessionsPanelOpen(false)}
                    currentSessionId={currentSessionId}
                    onSessionChange={handleSessionChange}
                    returnToWelcome={handleReturnToWelcome}
                    variant="overlay"
                    onSearchOpen={() => setSearchOpen(true)}
                    onNewChat={handleReturnToWelcome}
                    onSettingsOpen={() => setSettingsOpen(true)}
                    onPlaygroundOpen={() => window.open('/playground', '_blank')}
                    onThemeToggle={() => toggleTheme(theme === 'light')}
                    theme={theme}
                />
            </div>

            <main
                className="flex-1 h-full flex flex-col relative min-w-0"
                style={
                    { '--thread-max-width': '54rem' } as React.CSSProperties & {
                        '--thread-max-width': string;
                    }
                }
            >
                {/** Shared centered content width for welcome, messages, and composer */}
                {/** Keep this in sync to unify UI width like other chat apps */}
                {/** 720px base, expand to ~2xl on sm, ~3xl on lg */}
                {/* Unused var directive removed; keep code clean */}
                {(() => {
                    /* no-op to allow inline constant-like usage below via variable */
                    return null;
                })()}
                {/* Clean Header */}
                <header className="shrink-0 bg-background/80 backdrop-blur-sm relative">
                    <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                        {/* Left Section */}
                        <div className="flex items-center gap-3 shrink-0">
                            {/* Dexto Icon - Mobile only (desktop has collapsed sidebar) */}
                            <div className="md:hidden">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={handleOpenSessionsPanel}
                                            className="flex items-center hover:opacity-80 transition-opacity shrink-0"
                                            aria-label="Open chat history (⌘H)"
                                        >
                                            <img
                                                src="/logos/dexto/dexto_logo_icon.svg"
                                                alt="Dexto"
                                                className="h-8 w-8"
                                            />
                                            <span className="sr-only">
                                                Dexto - Open Chat History
                                            </span>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open Chat History (⌘H)</TooltipContent>
                                </Tooltip>
                            </div>

                            {/* Agent Selector */}
                            <div className="max-w-[180px] md:max-w-[260px]">
                                <AgentSelector mode="badge" />
                            </div>
                        </div>

                        {/* Right Section - Desktop buttons (hide when session panel is open on smaller screens) */}
                        <div
                            className={cn(
                                'hidden items-center gap-1',
                                isSessionsPanelOpen ? 'lg:flex' : 'md:flex'
                            )}
                        >
                            {/* Primary action group - Tools & Memories */}
                            <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-muted/30">
                                {/* Tools */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleOpenServersPanel}
                                            className={cn(
                                                'h-7 w-7 p-0 transition-colors',
                                                isServersPanelOpen && 'bg-background'
                                            )}
                                            aria-label="Toggle tools panel"
                                        >
                                            <Wrench className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Toggle tools panel (⌘J)</TooltipContent>
                                </Tooltip>

                                {/* Memories */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setMemoryPanelOpen(!isMemoryPanelOpen)}
                                            className={cn(
                                                'h-7 w-7 p-0 transition-colors',
                                                isMemoryPanelOpen && 'bg-background'
                                            )}
                                            aria-label="Toggle memories panel"
                                        >
                                            <Brain className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Toggle memories panel (⌘M)</TooltipContent>
                                </Tooltip>

                                {/* Customize Agent */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                setCustomizePanelOpen(!isCustomizePanelOpen)
                                            }
                                            className={cn(
                                                'h-7 w-7 p-0',
                                                isCustomizePanelOpen && 'bg-background'
                                            )}
                                            aria-label="Customize agent"
                                        >
                                            <FileEditIcon className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Customize Agent (⌘E)</TooltipContent>
                                </Tooltip>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {/* Always visible items */}
                                    <DropdownMenuItem onClick={() => setServerRegistryOpen(true)}>
                                        <Server className="h-4 w-4 mr-2" />
                                        Connect MCPs
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setExportOpen(true)}>
                                        <Download className="h-4 w-4 mr-2" />
                                        Export Config
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setShowShortcuts(true)}>
                                        <Keyboard className="h-4 w-4 mr-2" />
                                        Shortcuts
                                    </DropdownMenuItem>
                                    {/* Session Management Actions - Only show when there's an active session */}
                                    {currentSessionId && !isWelcomeState && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => setDeleteDialogOpen(true)}
                                                className="text-destructive focus:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Delete Conversation
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Right Section - Narrow screens (hamburger menu) - also show on md when session panel open */}
                        <div
                            className={cn('flex', isSessionsPanelOpen ? 'lg:hidden' : 'md:hidden')}
                        >
                            <DropdownMenu open={isMobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        aria-label="Open menu"
                                    >
                                        <Menu className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {/* All action buttons for narrow screens */}
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setCustomizePanelOpen(!isCustomizePanelOpen);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <FileEditIcon className="h-4 w-4 mr-2" />
                                        Customize Agent
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            handleOpenServersPanel();
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Wrench className="h-4 w-4 mr-2" />
                                        Tools
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            setMemoryPanelOpen(!isMemoryPanelOpen);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Brain className="h-4 w-4 mr-2" />
                                        Memories
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            toggleTheme(theme === 'light');
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <span className="h-4 w-4 mr-2">🌙</span>
                                        Toggle Theme
                                    </DropdownMenuItem>

                                    <DropdownMenuItem
                                        onClick={() => {
                                            setSettingsOpen(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Settings className="h-4 w-4 mr-2" />
                                        Settings
                                    </DropdownMenuItem>

                                    <DropdownMenuSeparator />

                                    {/* Always visible items */}
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setServerRegistryOpen(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Server className="h-4 w-4 mr-2" />
                                        Connect MCPs
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            window.open('/playground', '_blank');
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <FlaskConical className="h-4 w-4 mr-2" />
                                        MCP Playground
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setExportOpen(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export Config
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setShowShortcuts(true);
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <Keyboard className="h-4 w-4 mr-2" />
                                        Shortcuts
                                    </DropdownMenuItem>
                                    {/* Session Management Actions - Only show when there's an active session */}
                                    {currentSessionId && !isWelcomeState && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => {
                                                    setDeleteDialogOpen(true);
                                                    setMobileMenuOpen(false);
                                                }}
                                                className="text-destructive focus:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Delete Conversation
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </header>

                {/* Main Content Area */}
                <div className="flex-1 flex overflow-hidden min-w-0">
                    {/* Toasts */}
                    {successMessage && (
                        <div className="fixed bottom-4 right-4 z-50 border border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 text-foreground px-3 py-2 rounded-md shadow-md inline-flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-sm">{successMessage}</span>
                        </div>
                    )}
                    {/* Error Message */}
                    {errorMessage && (
                        <div className="absolute top-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-md shadow-lg">
                            {errorMessage}
                        </div>
                    )}

                    {/* Chat Content */}
                    <div className="flex-1 flex flex-col min-h-0 min-w-0">
                        {isWelcomeState ? (
                            /* Modern Welcome Screen with Central Search */
                            <div className="flex-1 flex flex-col justify-end sm:justify-center p-6 sm:-mt-20">
                                <div className="w-full max-w-full mx-auto pb-safe">
                                    {/* Greeting/Header Section - Narrowest */}
                                    <div className="text-center space-y-3 mb-8 max-w-full sm:max-w-3xl mx-auto">
                                        <h2 className="text-2xl font-bold font-mono tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text">
                                            {greeting || 'Welcome to Dexto'}
                                        </h2>
                                        <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
                                            Your AI assistant with powerful tools. Ask anything or
                                            connect new capabilities.
                                        </p>
                                    </div>

                                    {/* Quick Actions Grid - Medium width */}
                                    <div className="flex flex-wrap justify-center gap-2 mb-6 max-w-full sm:max-w-3xl lg:max-w-4xl mx-auto">
                                        {dynamicQuickActions.map((action, index) => {
                                            const button = (
                                                <button
                                                    key={index}
                                                    onClick={action.action}
                                                    className="group px-3 py-2 text-left rounded-full bg-primary/5 hover:bg-primary/10 transition-all duration-200 hover:shadow-sm hover:scale-105"
                                                >
                                                    <span className="font-medium text-sm text-primary group-hover:text-primary/80 transition-colors">
                                                        {action.description}
                                                    </span>
                                                </button>
                                            );

                                            if (action.tooltip) {
                                                return (
                                                    <Tooltip key={index}>
                                                        <TooltipTrigger asChild>
                                                            {button}
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {action.tooltip}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                );
                                            }

                                            return button;
                                        })}
                                    </div>

                                    {/* Central Input Bar - Narrowest, most focused */}
                                    <div className="max-w-full sm:max-w-3xl mx-auto mb-6">
                                        <InputArea
                                            onSend={handleSend}
                                            isSending={isSendingMessage}
                                            variant="welcome"
                                            isSessionsPanelOpen={isSessionsPanelOpen}
                                        />
                                    </div>

                                    {/* Quick Tips */}
                                    <div className="text-xs text-muted-foreground space-y-1 text-center max-w-full sm:max-w-3xl mx-auto">
                                        <p>
                                            💡 Try
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">
                                                ⌘K
                                            </kbd>{' '}
                                            for new chat,
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">
                                                ⌘J
                                            </kbd>{' '}
                                            for tools,
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">
                                                ⌘L
                                            </kbd>{' '}
                                            for playground,
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">
                                                ⌘⌫
                                            </kbd>{' '}
                                            to delete session,
                                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">
                                                ⌘/
                                            </kbd>{' '}
                                            for shortcuts
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Messages Area */
                            <div className="flex-1 min-h-0 overflow-hidden min-w-0">
                                <div
                                    ref={scrollContainerRef}
                                    className="h-full overflow-y-auto overflow-x-hidden overscroll-contain relative min-w-0"
                                >
                                    {/* Ensure the input dock sits at the very bottom even if content is short */}
                                    <div className="min-h-full grid grid-cols-1 grid-rows-[1fr_auto] min-w-0">
                                        <div className="w-full max-w-full sm:max-w-[var(--thread-max-width)] mx-0 sm:mx-auto min-w-0">
                                            <MessageList
                                                messages={messages}
                                                processing={processing}
                                                currentToolName={currentToolName}
                                                activeError={activeError}
                                                onDismissError={clearError}
                                                outerRef={listContentRef}
                                                pendingApproval={pendingApproval}
                                                onApprovalApprove={approvalHandlers?.onApprove}
                                                onApprovalDeny={approvalHandlers?.onDeny}
                                                sessionId={currentSessionId}
                                            />
                                        </div>
                                        {/* Sticky input dock inside scroll viewport */}
                                        <div
                                            className="sticky bottom-0 z-10 px-0 sm:px-4 pt-2 pb-2 bg-background relative"
                                            style={{
                                                paddingBottom:
                                                    'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
                                                marginBottom:
                                                    'calc(env(safe-area-inset-bottom, 0px) * -1)',
                                            }}
                                        >
                                            {showScrollHint && (
                                                <div className="absolute left-1/2 -translate-x-1/2 -top-3 z-20 pointer-events-none">
                                                    <button
                                                        onClick={() => {
                                                            setShowScrollHint(false);
                                                            scrollToBottom('smooth');
                                                        }}
                                                        className="pointer-events-auto px-3 py-1.5 rounded-full shadow-sm bg-background/95 border border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/80 text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                                                    >
                                                        <span>Scroll to bottom</span>
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                            <div className="w-full max-w-full sm:max-w-[var(--thread-max-width)] mx-0 sm:mx-auto pointer-events-auto">
                                                <InputArea
                                                    onSend={handleSend}
                                                    isSending={isSendingMessage}
                                                    variant="chat"
                                                    isSessionsPanelOpen={isSessionsPanelOpen}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    {/* Scroll to bottom button */}
                                    {/* Scroll hint now rendered inside sticky dock */}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Narrow screens: overlay panel */}
                    <div className="md:hidden">
                        <ServersPanel
                            isOpen={isServersPanelOpen}
                            onClose={() => setServersPanelOpen(false)}
                            onOpenConnectModal={() => setModalOpen(true)}
                            onOpenConnectWithPrefill={(opts) => {
                                setConnectPrefill(opts);
                                setModalOpen(true);
                            }}
                            onServerConnected={(name) => {
                                setServersRefreshTrigger((prev) => prev + 1);
                                setSuccessMessage(`Added ${name}`);
                                setTimeout(() => setSuccessMessage(null), 4000);
                            }}
                            variant="overlay"
                            refreshTrigger={serversRefreshTrigger}
                        />
                    </div>
                </div>

                {/* Customize Panel - Overlay Animation */}
                <CustomizePanel
                    isOpen={isCustomizePanelOpen}
                    onClose={() => setCustomizePanelOpen(false)}
                    variant="overlay"
                />

                {/* Connect Server Modal */}
                <ConnectServerModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setModalOpen(false);
                        setIsRegistryBusy(false);
                        setConnectPrefill(null);
                    }}
                    onServerConnected={async () => {
                        if (connectPrefill?.registryEntryId) {
                            try {
                                await serverRegistry.setInstalled(
                                    connectPrefill.registryEntryId,
                                    true
                                );
                            } catch (e) {
                                console.warn('Failed to mark registry entry installed:', e);
                            }
                        }
                        setServersRefreshTrigger((prev) => prev + 1);
                        const name = connectPrefill?.name || 'Server';
                        setSuccessMessage(`Added ${name}`);
                        setTimeout(() => setSuccessMessage(null), 4000);
                        connectPrefill?.onCloseRegistryModal?.();
                        setIsRegistryBusy(false);
                        setConnectPrefill(null);
                    }}
                    initialName={connectPrefill?.name}
                    initialConfig={connectPrefill?.config}
                    lockName={connectPrefill?.lockName}
                />

                {/* Server Registry Modal */}
                <ServerRegistryModal
                    isOpen={isServerRegistryOpen}
                    onClose={() => setServerRegistryOpen(false)}
                    onInstallServer={handleInstallServer}
                    onOpenConnectModal={() => setModalOpen(true)}
                    refreshTrigger={serversRefreshTrigger}
                    disableClose={isRegistryBusy}
                />

                {/* Export Configuration Modal */}
                <Dialog open={isExportOpen} onOpenChange={setExportOpen}>
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center space-x-2">
                                <Download className="h-5 w-5" />
                                <span>Export Configuration</span>
                            </DialogTitle>
                            <DialogDescription>
                                Download your tool configuration for Claude Desktop or other MCP
                                clients
                                {currentSessionId && (
                                    <span className="block mt-1 text-sm text-muted-foreground">
                                        Including session-specific settings for:{' '}
                                        <span className="font-mono">{currentSessionId}</span>
                                    </span>
                                )}
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="filename">File name</Label>
                                <Input
                                    id="filename"
                                    value={exportName}
                                    onChange={(e) => setExportName(e.target.value)}
                                    placeholder="dexto-config"
                                    className="font-mono"
                                />
                            </div>

                            {exportError && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Export Error</AlertTitle>
                                    <AlertDescription>{exportError}</AlertDescription>
                                </Alert>
                            )}

                            {exportContent && (
                                <div className="space-y-2">
                                    <Label>Configuration Preview</Label>
                                    <Textarea
                                        value={exportContent}
                                        readOnly
                                        className="h-32 font-mono text-xs bg-muted/30"
                                    />
                                </div>
                            )}
                        </div>

                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={handleCopy}
                                className="flex items-center space-x-2"
                            >
                                <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
                            </Button>
                            <Button
                                onClick={handleDownload}
                                className="flex items-center space-x-2"
                            >
                                <Download className="h-4 w-4" />
                                <span>Download</span>
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Settings Panel */}
                <SettingsPanel isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />

                {/* Memory Panel */}
                <MemoryPanel
                    isOpen={isMemoryPanelOpen}
                    onClose={() => setMemoryPanelOpen(false)}
                    variant="modal"
                />

                {/* Delete Conversation Confirmation Modal */}
                <Dialog open={isDeleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center space-x-2">
                                <Trash2 className="h-5 w-5 text-destructive" />
                                <span>Delete Conversation</span>
                            </DialogTitle>
                            <DialogDescription>
                                This will permanently delete this conversation and all its messages.
                                This action cannot be undone.
                                {currentSessionId && (
                                    <span className="block mt-2 font-medium">
                                        Session:{' '}
                                        <span className="font-mono">{currentSessionId}</span>
                                    </span>
                                )}
                            </DialogDescription>
                        </DialogHeader>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDeleteConversation}
                                disabled={deleteSessionMutation.isPending}
                                className="flex items-center space-x-2"
                            >
                                <Trash2 className="h-4 w-4" />
                                <span>
                                    {deleteSessionMutation.isPending
                                        ? 'Deleting...'
                                        : 'Delete Conversation'}
                                </span>
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Shortcuts Modal */}
                <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center space-x-2">
                                <Keyboard className="h-5 w-5" />
                                <span>Keyboard Shortcuts</span>
                            </DialogTitle>
                        </DialogHeader>

                        <div className="space-y-3">
                            {[
                                { key: '⌘H', desc: 'Toggle chat history panel' },
                                { key: '⌘K', desc: 'Create new chat' },
                                { key: '⌘J', desc: 'Toggle tools panel' },
                                { key: '⌘M', desc: 'Toggle memories panel' },
                                { key: '⌘E', desc: 'Customize agent' },
                                { key: '⌘⇧S', desc: 'Search conversations' },
                                { key: '⌘L', desc: 'Open MCP playground' },
                                { key: '⌘⇧E', desc: 'Export config' },
                                { key: '⌘/', desc: 'Show shortcuts' },
                                { key: '⌘⌫', desc: 'Delete current session' },
                                { key: 'Esc', desc: 'Close panels' },
                            ].map((shortcut, index) => (
                                <div key={index} className="flex justify-between items-center py-1">
                                    <span className="text-sm text-muted-foreground">
                                        {shortcut.desc}
                                    </span>
                                    <Badge variant="outline" className="font-mono text-xs">
                                        {shortcut.key}
                                    </Badge>
                                </div>
                            ))}
                        </div>

                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline">Close</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main>

            {/* Servers Panel - Desktop: inline panel (sibling to main for full height) */}
            <div
                className={cn(
                    'hidden md:block h-full shrink-0 transition-all duration-300 ease-in-out border-l border-border/50 bg-card/50 backdrop-blur-sm',
                    isServersPanelOpen ? 'w-80' : 'w-0 overflow-hidden'
                )}
            >
                {isServersPanelOpen && (
                    <ServersPanel
                        isOpen={isServersPanelOpen}
                        onClose={() => setServersPanelOpen(false)}
                        onOpenConnectModal={() => setModalOpen(true)}
                        onOpenConnectWithPrefill={(opts) => {
                            setConnectPrefill(opts);
                            setModalOpen(true);
                        }}
                        onServerConnected={(name) => {
                            setServersRefreshTrigger((prev) => prev + 1);
                            setSuccessMessage(`Added ${name}`);
                            setTimeout(() => setSuccessMessage(null), 4000);
                        }}
                        variant="inline"
                        refreshTrigger={serversRefreshTrigger}
                    />
                )}
            </div>

            {/* Global Search Modal */}
            <GlobalSearchModal
                isOpen={isSearchOpen}
                onClose={() => setSearchOpen(false)}
                onNavigateToSession={(sessionId) => {
                    navigate({ to: `/chat/${sessionId}` });
                    setSearchOpen(false);
                }}
            />

            {/* Tool Confirmation Handler */}
            <ToolConfirmationHandler
                onApprovalRequest={setPendingApproval}
                onHandlersReady={setApprovalHandlers}
            />
        </div>
    );
}
