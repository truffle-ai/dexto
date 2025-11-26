'use client';

import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys.js';
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
    X,
    Plus,
    MoreHorizontal,
    Pencil,
    Copy,
    Check,
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
    currentSessionId?: string | null;
    onSessionChange: (sessionId: string) => void;
    returnToWelcome: () => void;
    variant?: 'inline' | 'overlay';
    onSearchOpen?: () => void;
    onNewChat?: () => void;
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
    currentSessionId,
    onSessionChange,
    returnToWelcome,
    variant = 'overlay',
    onSearchOpen,
    onNewChat,
}: SessionPanelProps) {
    const queryClient = useQueryClient();
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

    // Listen for agent switch events to invalidate sessions cache
    // Note: message/response/title events are now handled in useChat via direct cache updates
    useEffect(() => {
        const handleAgentSwitched = () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);
            return () => {
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
    }, [queryClient]);

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
            {/* Header with action buttons */}
            <div className="p-3 space-y-3 border-b border-border/50">
                {/* Header row with title and close button */}
                <div className="flex items-center justify-between">
                    <h2 id="sessionpanel-title" className="text-base font-semibold">
                        Chat History
                    </h2>
                    {variant === 'overlay' && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClose}
                            className="h-7 w-7 p-0"
                            aria-label="Close panel"
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                    {onNewChat && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onNewChat}
                            className="w-full h-9 justify-start gap-2"
                        >
                            <Plus className="h-4 w-4" />
                            <span>New Chat</span>
                        </Button>
                    )}
                    {onSearchOpen && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onSearchOpen}
                            className="w-full h-9 justify-start gap-2"
                        >
                            <Search className="h-4 w-4" />
                            <span>Search Chats</span>
                        </Button>
                    )}
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
            <ScrollArea className="flex-1">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-6 w-6 animate-spin" />
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground px-4">
                        <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No chat history</p>
                        <p className="text-sm">Start a conversation to see it here</p>
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
                                        'group relative px-3 py-2.5 rounded-lg transition-colors cursor-pointer',
                                        isActive
                                            ? 'bg-muted/40 hover:bg-muted/60'
                                            : 'hover:bg-muted/30'
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
                                        <div className="flex-1 min-w-0">
                                            <h3
                                                className={cn(
                                                    'text-sm truncate',
                                                    isActive
                                                        ? 'font-semibold'
                                                        : 'font-normal text-muted-foreground'
                                                )}
                                            >
                                                {title}
                                            </h3>
                                            <span className="text-xs text-muted-foreground">
                                                {formatRelativeTime(session.lastActivity)}
                                            </span>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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

    // For inline variant, just return the content wrapped
    if (variant === 'inline') {
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
                    'fixed top-0 left-0 z-40 h-screen w-80 bg-card border-r border-border shadow-xl transition-transform duration-300 ease-in-out flex flex-col',
                    isOpen ? 'translate-x-0' : '-translate-x-full'
                )}
            >
                {content}
            </aside>
        </>
    );
}
