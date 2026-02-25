import React, { useState } from 'react';
import { useDebounce } from 'use-debounce';
import {
    useSearchMessages,
    useSearchSessions,
    type SearchResult,
    type SessionSearchResult,
} from './hooks/useSearch';
import { formatDate, formatTime } from '@/lib/date-utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Dialog, DialogContent } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import {
    Search,
    MessageSquare,
    Clock,
    User,
    Bot,
    Settings,
    X,
    ChevronRight,
    AlertTriangle,
    RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from './ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface SearchPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigateToSession: (sessionId: string, messageIndex?: number) => void;
    variant?: 'inline' | 'modal' | 'popover';
}

type SearchMode = 'messages' | 'sessions';

export default function SearchPanel({
    isOpen,
    onClose,
    onNavigateToSession,
    variant = 'modal',
}: SearchPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery] = useDebounce(searchQuery, 300);
    const [searchMode, setSearchMode] = useState<SearchMode>('messages');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [sessionFilter, setSessionFilter] = useState<string>('');

    // Use TanStack Query hooks for search
    const {
        data: messageData,
        isLoading: messageLoading,
        error: messageError,
    } = useSearchMessages(
        debouncedQuery,
        sessionFilter || undefined,
        20,
        isOpen && searchMode === 'messages'
    );

    const {
        data: sessionData,
        isLoading: sessionLoading,
        error: sessionError,
    } = useSearchSessions(debouncedQuery, isOpen && searchMode === 'sessions');

    // Derive state from query results
    const messageResults = messageData?.results || [];
    const sessionResults = sessionData?.results || [];
    const isLoading = searchMode === 'messages' ? messageLoading : sessionLoading;
    const error = searchMode === 'messages' ? messageError : sessionError;
    const total = searchMode === 'messages' ? messageData?.total || 0 : sessionData?.total || 0;

    const handleResultClick = (result: SearchResult) => {
        onNavigateToSession(result.sessionId, result.messageIndex);
        onClose();
    };

    const handleSessionResultClick = (sessionResult: SessionSearchResult) => {
        onNavigateToSession(sessionResult.sessionId, sessionResult.firstMatch.messageIndex);
        onClose();
    };

    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'user':
                return <User className="w-4 h-4" />;
            case 'assistant':
                return <Bot className="w-4 h-4" />;
            case 'system':
                return <Settings className="w-4 h-4" />;
            default:
                return <MessageSquare className="w-4 h-4" />;
        }
    };

    const getRoleColor = (role: string) => {
        switch (role) {
            case 'user':
                return 'bg-blue-100 text-blue-800';
            case 'assistant':
                return 'bg-green-100 text-green-800';
            case 'system':
                return 'bg-yellow-100 text-yellow-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    const highlightText = (text: string, query: string) => {
        if (!query) return text;

        const regex = new RegExp(`(${query})`, 'gi');
        const parts = text.split(regex);

        return parts.map((part, index) =>
            regex.test(part) ? (
                <mark key={index} className="bg-yellow-200 font-medium">
                    {part}
                </mark>
            ) : (
                part
            )
        );
    };

    const content = (
        <div className={cn('flex flex-col h-full', variant === 'modal' && 'min-h-[600px]')}>
            {/* Search Input - moved to top for better UX */}
            <div className="p-4 border-b border-border/50 space-y-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>

                {/* Search Mode Toggle */}
                <div className="flex gap-2">
                    <Button
                        variant={searchMode === 'messages' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSearchMode('messages')}
                        className="flex-1"
                    >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Messages
                    </Button>
                    <Button
                        variant={searchMode === 'sessions' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSearchMode('sessions')}
                        className="flex-1"
                    >
                        <Clock className="w-4 h-4 mr-2" />
                        Sessions
                    </Button>
                </div>

                {/* Filters for message search */}
                {searchMode === 'messages' && (
                    <div className="flex gap-2">
                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                            <SelectTrigger className="w-28">
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="assistant">Assistant</SelectItem>
                                <SelectItem value="system">System</SelectItem>
                            </SelectContent>
                        </Select>

                        <Input
                            placeholder="Session ID (optional)"
                            value={sessionFilter}
                            onChange={(e) => setSessionFilter(e.target.value)}
                            className="flex-1 text-sm"
                        />
                    </div>
                )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-hidden">
                {error && (
                    <div className="p-4">
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>{error?.message || 'Search failed'}</AlertDescription>
                        </Alert>
                    </div>
                )}

                <ScrollArea className="h-full">
                    <div className="p-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                                <div className="text-muted-foreground">Searching...</div>
                            </div>
                        ) : (
                            <>
                                {/* Results Summary */}
                                {searchQuery && (
                                    <div className="mb-4 text-sm text-muted-foreground">
                                        {total > 0 ? (
                                            <>
                                                Found {total}{' '}
                                                {searchMode === 'messages'
                                                    ? 'messages'
                                                    : 'sessions'}{' '}
                                                matching "{searchQuery}"
                                            </>
                                        ) : (
                                            <>
                                                No{' '}
                                                {searchMode === 'messages'
                                                    ? 'messages'
                                                    : 'sessions'}{' '}
                                                found matching "{searchQuery}"
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Message Results */}
                                {searchMode === 'messages' && messageResults.length > 0 && (
                                    <div className="space-y-2">
                                        {messageResults.map(
                                            (result: SearchResult, index: number) => (
                                                <div
                                                    key={index}
                                                    className="p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer"
                                                    onClick={() => handleResultClick(result)}
                                                >
                                                    <div className="flex items-start justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <Badge
                                                                className={cn(
                                                                    'text-xs',
                                                                    getRoleColor(
                                                                        result.message.role
                                                                    )
                                                                )}
                                                            >
                                                                {getRoleIcon(result.message.role)}
                                                                <span className="ml-1 capitalize">
                                                                    {result.message.role}
                                                                </span>
                                                            </Badge>
                                                            <span className="text-sm text-muted-foreground">
                                                                Session:{' '}
                                                                {result.sessionId.slice(0, 8)}
                                                                ...
                                                            </span>
                                                        </div>
                                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                    </div>

                                                    <div className="text-sm">
                                                        {highlightText(result.context, searchQuery)}
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}

                                {/* Session Results */}
                                {searchMode === 'sessions' && sessionResults.length > 0 && (
                                    <div className="space-y-2">
                                        {sessionResults.map(
                                            (sessionResult: SessionSearchResult, index: number) => (
                                                <div
                                                    key={index}
                                                    className="p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer"
                                                    onClick={() =>
                                                        handleSessionResultClick(sessionResult)
                                                    }
                                                >
                                                    <div className="flex items-start justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <MessageSquare className="w-4 h-4 text-muted-foreground" />
                                                            <span className="font-medium">
                                                                {sessionResult.sessionId.slice(
                                                                    0,
                                                                    12
                                                                )}
                                                                ...
                                                            </span>
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                {sessionResult.matchCount} matches
                                                            </Badge>
                                                        </div>
                                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                    </div>

                                                    <div className="text-sm text-muted-foreground mb-2">
                                                        {sessionResult.metadata.messageCount}{' '}
                                                        messages • Created{' '}
                                                        {formatDate(
                                                            sessionResult.metadata.createdAt
                                                        )}{' '}
                                                        • Last active{' '}
                                                        {formatTime(
                                                            sessionResult.metadata.lastActivity
                                                        )}
                                                    </div>

                                                    <div className="text-sm">
                                                        {highlightText(
                                                            sessionResult.firstMatch.context,
                                                            searchQuery
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}

                                {/* No Results */}
                                {searchQuery &&
                                    !isLoading &&
                                    (searchMode === 'messages'
                                        ? messageResults.length === 0
                                        : sessionResults.length === 0) && (
                                        <div className="text-center py-8 text-muted-foreground">
                                            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                            <p>
                                                No{' '}
                                                {searchMode === 'messages'
                                                    ? 'messages'
                                                    : 'sessions'}{' '}
                                                found matching your search.
                                            </p>
                                            <p className="text-sm mt-2">
                                                Try adjusting your search terms or filters.
                                            </p>
                                        </div>
                                    )}

                                {/* Empty State */}
                                {!searchQuery && (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                        <p>Start typing to search through your conversations.</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );

    if (variant === 'inline') {
        return <div className="h-full flex flex-col">{content}</div>;
    }

    if (variant === 'popover') {
        if (!isOpen) return null;
        return (
            <>
                {/* Backdrop */}
                <div
                    className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
                    onClick={onClose}
                />
                {/* Popover panel */}
                <div className="fixed left-4 top-4 z-50 w-[400px] max-h-[80vh] bg-popover/95 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl overflow-hidden">
                    <div className="flex items-center justify-between p-3 border-b border-border/50">
                        <h3 className="text-sm font-medium">Search Chats</h3>
                        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="max-h-[calc(80vh-48px)] overflow-y-auto">{content}</div>
                </div>
            </>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl h-[80vh] p-0">{content}</DialogContent>
        </Dialog>
    );
}
