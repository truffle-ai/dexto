import React, { useState, useEffect } from 'react';
import {
    useSessions,
    useCreateSession,
    useDeleteSession,
    useRenameSession,
    type Session,
} from './hooks/useSessions';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import {
    Trash2,
    AlertTriangle,
    RefreshCw,
    History,
    Search,
    Plus,
    MoreHorizontal,
    Pencil,
    Copy,
    Check,
    ChevronLeft,
    Settings,
    FlaskConical,
    Moon,
    Sun,
} from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface SessionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onExpand?: () => void;
    currentSessionId?: string | null;
    onSessionChange: (sessionId: string) => void;
    returnToWelcome: () => void;
    variant?: 'inline' | 'overlay';
    onSearchOpen?: () => void;
    onNewChat?: () => void;
    // App-level actions
    onSettingsOpen?: () => void;
    onPlaygroundOpen?: () => void;
    onThemeToggle?: () => void;
    theme?: 'light' | 'dark';
}

function sortSessions(sessions: Session[]): Session[] {
    return sessions.sort((a, b) => {
        const timeA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const timeB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return timeB - timeA;
    });
}

export default function SessionPanel({
    isOpen,
    onClose,
    onExpand,
    currentSessionId,
    onSessionChange,
    returnToWelcome,
    variant = 'overlay',
    onSearchOpen,
    onNewChat,
    onSettingsOpen,
    onPlaygroundOpen,
    onThemeToggle,
    theme,
}: SessionPanelProps) {
    const [isNewSessionOpen, setNewSessionOpen] = useState(false);
    const [newSessionId, setNewSessionId] = useState('');
    const [isDeleteConversationDialogOpen, setDeleteConversationDialogOpen] = useState(false);
    const [selectedSessionForAction, setSelectedSessionForAction] = useState<string | null>(null);
    const [isRenameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

    const { data: sessionsData = [], isLoading: loading, error } = useSessions(isOpen);

    // Sort sessions by last activity for display
    const sessions = sortSessions([...sessionsData]);

    const createSessionMutation = useCreateSession();
    const deleteSessionMutation = useDeleteSession();
    const renameSessionMutation = useRenameSession();

    // Note: Agent switch invalidation is now handled centrally in AgentSelector
    // Message/response/title events are handled in useChat via direct cache updates

    const handleCreateSession = async () => {
        const newSession = await createSessionMutation.mutateAsync({
            sessionId: newSessionId.trim() || undefined,
        });
        setNewSessionId('');
        setNewSessionOpen(false);
        onSessionChange(newSession.id);
    };

    const handleDeleteSession = async (sessionId: string) => {
        await deleteSessionMutation.mutateAsync({ sessionId });
        const isDeletingCurrentSession = currentSessionId === sessionId;
        if (isDeletingCurrentSession) {
            returnToWelcome();
        }
    };

    const handleDeleteConversation = async () => {
        if (!selectedSessionForAction) return;
        await deleteSessionMutation.mutateAsync({ sessionId: selectedSessionForAction });
        const isDeletingCurrentSession = currentSessionId === selectedSessionForAction;
        if (isDeletingCurrentSession) {
            returnToWelcome();
        }
        setDeleteConversationDialogOpen(false);
        setSelectedSessionForAction(null);
    };

    const handleOpenRenameDialog = (sessionId: string, currentTitle: string | null) => {
        setSelectedSessionForAction(sessionId);
        setRenameValue(currentTitle || '');
        setRenameDialogOpen(true);
    };

    const handleRenameSession = async () => {
        if (!selectedSessionForAction || !renameValue.trim()) return;
        try {
            await renameSessionMutation.mutateAsync({
                sessionId: selectedSessionForAction,
                title: renameValue.trim(),
            });
            setRenameDialogOpen(false);
            setSelectedSessionForAction(null);
            setRenameValue('');
        } catch (error) {
            // Error is already logged by React Query, keep dialog open for retry
            console.error(`Failed to rename session: ${error}`);
        }
    };

    const handleCopySessionId = async (sessionId: string) => {
        try {
            await navigator.clipboard.writeText(sessionId);
            setCopiedSessionId(sessionId);
        } catch (error) {
            console.error(`Failed to copy session ID: ${error}`);
        }
    };

    // Clean up copy feedback timeout
    useEffect(() => {
        if (copiedSessionId) {
            const timeoutId = setTimeout(() => setCopiedSessionId(null), 2000);
            return () => clearTimeout(timeoutId);
        }
    }, [copiedSessionId]);

    const formatRelativeTime = (timestamp: number | null) => {
        if (!timestamp) return 'Unknown';
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    };

    const content = (
        <div className="flex flex-col h-full">
            {/* Header with Dexto branding */}
            <div className="px-4 py-5">
                <div className="flex items-center justify-between">
                    {/* Dexto logo */}
                    <div id="sessionpanel-title" className="flex items-center px-2">
                        {/* Light mode logo */}
                        <img
                            src="/logos/dexto/dexto_logo_light.svg"
                            alt="Dexto"
                            className="h-6 w-auto dark:hidden"
                        />
                        {/* Dark mode logo */}
                        <img
                            src="/logos/dexto/dexto_logo.svg"
                            alt="Dexto"
                            className="h-6 w-auto hidden dark:block"
                        />
                    </div>

                    {/* Collapse button */}
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        aria-label="Collapse panel"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{error.message}</AlertDescription>
                    </Alert>
                </div>
            )}

            {/* Sessions List */}
            <ScrollArea className="flex-1 scrollbar-thin">
                {/* Action items at top of list */}
                <div className="px-3 pt-2 pb-1 space-y-0.5">
                    {onNewChat && (
                        <button
                            onClick={onNewChat}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            <span>New Chat</span>
                        </button>
                    )}
                    {onSearchOpen && (
                        <button
                            onClick={onSearchOpen}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        >
                            <Search className="h-4 w-4" />
                            <span>Search</span>
                        </button>
                    )}
                </div>

                {/* Spacer */}
                {(onNewChat || onSearchOpen) && <div className="h-2" />}

                {/* History Header */}
                {!loading && sessions.length > 0 && (
                    <div className="px-4 py-2">
                        <h2 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                            History
                        </h2>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="text-center py-12 px-6">
                        <History className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">No conversations yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                            Start chatting to see your history
                        </p>
                    </div>
                ) : (
                    <div className="px-3 py-2 space-y-0.5">
                        {sessions.map((session) => {
                            const title =
                                session.title && session.title.trim().length > 0
                                    ? session.title
                                    : session.id;
                            const isActive = currentSessionId === session.id;
                            return (
                                <div
                                    key={session.id}
                                    className={cn(
                                        'group relative px-3 py-1.5 rounded-lg transition-all cursor-pointer',
                                        isActive
                                            ? 'bg-primary/5 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-primary before:rounded-full'
                                            : 'hover:bg-muted/40'
                                    )}
                                    role="button"
                                    tabIndex={0}
                                    aria-current={isActive ? 'page' : undefined}
                                    onClick={() => onSessionChange(session.id)}
                                    onKeyDown={(e) => {
                                        if (e.target !== e.currentTarget) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onSessionChange(session.id);
                                        }
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <h3
                                            className={cn(
                                                'text-sm truncate flex-1 min-w-0',
                                                isActive
                                                    ? 'font-medium text-foreground'
                                                    : 'text-muted-foreground'
                                            )}
                                        >
                                            {title}
                                        </h3>

                                        {/* Timestamp - hidden on hover */}
                                        <span className="text-[10px] text-muted-foreground/50 shrink-0 group-hover:opacity-0 transition-opacity">
                                            {formatRelativeTime(session.lastActivity)}
                                        </span>

                                        {/* Dropdown - shown on hover, positioned to overlap timestamp */}
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-7 w-7 p-0 absolute right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                                    aria-label="Session options"
                                                >
                                                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent
                                                align="end"
                                                className="w-48"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <DropdownMenuItem
                                                    onClick={() =>
                                                        handleOpenRenameDialog(
                                                            session.id,
                                                            session.title ?? null
                                                        )
                                                    }
                                                >
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Rename
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleCopySessionId(session.id)}
                                                >
                                                    {copiedSessionId === session.id ? (
                                                        <Check className="h-4 w-4 mr-2 text-green-500" />
                                                    ) : (
                                                        <Copy className="h-4 w-4 mr-2" />
                                                    )}
                                                    {copiedSessionId === session.id
                                                        ? 'Copied!'
                                                        : 'Copy Session ID'}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    onClick={() => {
                                                        if (session.messageCount > 0) {
                                                            setSelectedSessionForAction(session.id);
                                                            setDeleteConversationDialogOpen(true);
                                                        } else {
                                                            handleDeleteSession(session.id);
                                                        }
                                                    }}
                                                    className="text-destructive focus:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </ScrollArea>

            {/* Footer with app-level actions */}
            <div className="border-t border-border/30 p-3 space-y-1">
                {/* Developer Tools */}
                {onPlaygroundOpen && (
                    <button
                        onClick={onPlaygroundOpen}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                    >
                        <FlaskConical className="h-4 w-4" />
                        <span>MCP Playground</span>
                    </button>
                )}

                {/* Separator */}
                {onPlaygroundOpen && (onThemeToggle || onSettingsOpen) && (
                    <div className="h-px bg-border/30 my-1" />
                )}

                {/* Theme Toggle */}
                {onThemeToggle && (
                    <button
                        onClick={onThemeToggle}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                    >
                        {theme === 'dark' ? (
                            <Sun className="h-4 w-4 transition-transform duration-200 hover:rotate-180" />
                        ) : (
                            <Moon className="h-4 w-4 transition-transform duration-200 hover:rotate-12" />
                        )}
                        <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                )}

                {/* Settings */}
                {onSettingsOpen && (
                    <button
                        onClick={onSettingsOpen}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                    >
                        <Settings className="h-4 w-4" />
                        <span>Settings</span>
                    </button>
                )}
            </div>

            {/* New Chat Dialog */}
            <Dialog open={isNewSessionOpen} onOpenChange={setNewSessionOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Start New Chat</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="sessionId">Chat ID</Label>
                            <Input
                                id="sessionId"
                                value={newSessionId}
                                onChange={(e) => setNewSessionId(e.target.value)}
                                placeholder="e.g., user-123, project-alpha"
                                className="font-mono"
                            />
                            <p className="text-xs text-muted-foreground">
                                Leave empty to auto-generate a unique ID
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewSessionOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateSession}>Start Chat</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Conversation Confirmation Dialog */}
            <Dialog
                open={isDeleteConversationDialogOpen}
                onOpenChange={setDeleteConversationDialogOpen}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center space-x-2">
                            <Trash2 className="h-5 w-5 text-destructive" />
                            <span>Delete Conversation</span>
                        </DialogTitle>
                        <DialogDescription>
                            This will permanently delete this conversation and all its messages.
                            This action cannot be undone.
                            {selectedSessionForAction && (
                                <span className="block mt-2 font-medium">
                                    Session:{' '}
                                    <span className="font-mono">{selectedSessionForAction}</span>
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteConversationDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteConversation}
                            disabled={
                                deleteSessionMutation.isPending &&
                                deleteSessionMutation.variables?.sessionId ===
                                    selectedSessionForAction
                            }
                            className="flex items-center space-x-2"
                        >
                            <Trash2 className="h-4 w-4" />
                            <span>
                                {deleteSessionMutation.isPending &&
                                deleteSessionMutation.variables?.sessionId ===
                                    selectedSessionForAction
                                    ? 'Deleting...'
                                    : 'Delete Conversation'}
                            </span>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Session Dialog */}
            <Dialog open={isRenameDialogOpen} onOpenChange={setRenameDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center space-x-2">
                            <Pencil className="h-5 w-5" />
                            <span>Rename Chat</span>
                        </DialogTitle>
                        <DialogDescription>
                            Enter a new name for this conversation.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="renameTitle">Chat Name</Label>
                            <Input
                                id="renameTitle"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                placeholder="Enter chat name..."
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && renameValue.trim()) {
                                        handleRenameSession();
                                    }
                                }}
                                autoFocus
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRenameSession}
                            disabled={!renameValue.trim() || renameSessionMutation.isPending}
                        >
                            {renameSessionMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );

    // Collapsed sidebar content - thin bar with icon buttons
    const collapsedContent = (
        <div className="flex flex-col h-full py-3 px-2 items-center">
            {/* Dexto icon - click to expand */}
            <button
                onClick={onExpand}
                className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-muted/40 transition-colors mb-3"
                aria-label="Expand panel"
            >
                <img src="/logos/dexto/dexto_logo_icon.svg" alt="Dexto" className="h-7 w-7" />
            </button>

            {/* Action items with subtle spacing */}
            <div className="flex flex-col gap-1 flex-1">
                {/* New Chat */}
                {onNewChat && (
                    <button
                        onClick={onNewChat}
                        className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        aria-label="New chat"
                    >
                        <Plus className="h-5 w-5" />
                    </button>
                )}

                {/* Search */}
                {onSearchOpen && (
                    <button
                        onClick={onSearchOpen}
                        className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        aria-label="Search"
                    >
                        <Search className="h-5 w-5" />
                    </button>
                )}
            </div>

            {/* Footer actions - playground, theme, settings */}
            <div className="flex flex-col gap-1 pt-2 border-t border-border/30">
                {/* Playground */}
                {onPlaygroundOpen && (
                    <button
                        onClick={onPlaygroundOpen}
                        className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        aria-label="MCP Playground"
                    >
                        <FlaskConical className="h-5 w-5" />
                    </button>
                )}

                {/* Theme Toggle */}
                {onThemeToggle && (
                    <button
                        onClick={onThemeToggle}
                        className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                    >
                        {theme === 'dark' ? (
                            <Sun className="h-5 w-5" />
                        ) : (
                            <Moon className="h-5 w-5" />
                        )}
                    </button>
                )}

                {/* Settings */}
                {onSettingsOpen && (
                    <button
                        onClick={onSettingsOpen}
                        className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                        aria-label="Settings"
                    >
                        <Settings className="h-5 w-5" />
                    </button>
                )}
            </div>
        </div>
    );

    // For inline variant, show collapsed or expanded
    if (variant === 'inline') {
        if (!isOpen) {
            // Collapsed state - thin bar
            return (
                <div className="h-full flex flex-col bg-card border-r border-border/30">
                    {collapsedContent}
                </div>
            );
        }
        // Expanded state - full panel
        return <div className="h-full w-full flex flex-col bg-card">{content}</div>;
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

            {/* Panel */}
            <aside
                role="dialog"
                aria-modal="true"
                aria-labelledby="sessionpanel-title"
                tabIndex={-1}
                className={cn(
                    'fixed top-0 left-0 z-40 h-screen w-72 bg-card border-r border-border shadow-xl transition-transform duration-300 ease-in-out flex flex-col',
                    isOpen ? 'translate-x-0' : '-translate-x-full'
                )}
            >
                {content}
            </aside>
        </>
    );
}
