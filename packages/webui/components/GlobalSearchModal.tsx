import React, { useState, useEffect, useCallback } from 'react';
import { useDebounce } from 'use-debounce';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSearchMessages, type SearchResult } from './hooks/useSearch';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Search, MessageSquare, User, Bot, Settings, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';

interface GlobalSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigateToSession: (sessionId: string, messageIndex?: number) => void;
}

export default function GlobalSearchModal({
    isOpen,
    onClose,
    onNavigateToSession,
}: GlobalSearchModalProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery] = useDebounce(searchQuery, 300);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Use TanStack Query for search with debouncing
    const { data, isLoading, error } = useSearchMessages(debouncedQuery, undefined, 10, isOpen);

    const results = data?.results || [];
    const searchError = error?.message ?? null;

    // Clamp selectedIndex when results change to prevent out-of-bounds selection
    useEffect(() => {
        if (selectedIndex >= results.length && results.length > 0) {
            setSelectedIndex(results.length - 1);
        } else if (results.length === 0) {
            setSelectedIndex(0);
        }
    }, [results.length, selectedIndex]);

    const handleResultClick = useCallback(
        (result: SearchResult) => {
            onNavigateToSession(result.sessionId, result.messageIndex);
            onClose();
        },
        [onNavigateToSession, onClose]
    );

    // Reset when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setSearchQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    // Keyboard navigation (using react-hotkeys-hook)
    // ArrowDown to navigate down in results
    useHotkeys(
        'down',
        () => {
            setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        },
        { enabled: isOpen, preventDefault: true },
        [isOpen, results.length]
    );

    // ArrowUp to navigate up in results
    useHotkeys(
        'up',
        () => {
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        },
        { enabled: isOpen, preventDefault: true },
        [isOpen]
    );

    // Enter to select current result
    useHotkeys(
        'enter',
        () => {
            if (results[selectedIndex]) {
                handleResultClick(results[selectedIndex]);
                setSelectedIndex(0);
            }
        },
        { enabled: isOpen, preventDefault: true },
        [isOpen, results, selectedIndex, handleResultClick]
    );

    // Escape to close modal
    useHotkeys(
        'escape',
        () => {
            onClose();
        },
        { enabled: isOpen, preventDefault: true },
        [isOpen, onClose]
    );

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
                return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
            case 'assistant':
                return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
            case 'system':
                return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
            default:
                return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
        }
    };

    const highlightText = (text: string, query: string) => {
        if (!query) return text;

        const escapedQuery = query.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        const parts = text.split(regex);

        return parts.map((part, index) =>
            part.toLowerCase() === query.toLowerCase() ? (
                <mark
                    key={index}
                    className="bg-yellow-200 dark:bg-yellow-800 font-medium rounded px-1"
                >
                    {part}
                </mark>
            ) : (
                part
            )
        );
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[2px]" onClick={onClose} />
            {/* Search popover */}
            <div className="fixed left-1/2 top-[15%] -translate-x-1/2 z-50 w-full max-w-2xl bg-popover/70 backdrop-blur-xl border border-border/30 rounded-xl shadow-2xl overflow-hidden">
                <div className="flex flex-col max-h-[70vh]">
                    {/* Search Header */}
                    <div className="p-4 border-b border-border/30">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                            <Input
                                placeholder="Search conversations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-12 text-lg border-0 shadow-none focus-visible:ring-0 bg-transparent"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Results */}
                    <div className="flex-1 overflow-hidden">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <RefreshCw className="h-6 w-6 animate-spin mr-3" />
                                <span className="text-muted-foreground">Searching...</span>
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="text-center">
                                    <Search className="w-12 h-12 mx-auto mb-4 text-destructive opacity-50" />
                                    <p className="text-destructive font-medium">Search Error</p>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        {searchError}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-2">
                                        Try again or check your connection.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <ScrollArea className="h-full max-h-[calc(70vh-80px)]">
                                <div className="p-2">
                                    {results.length > 0 ? (
                                        <div className="space-y-1">
                                            {results.map((result: SearchResult, index: number) => (
                                                <div
                                                    key={index}
                                                    className={cn(
                                                        'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors',
                                                        index === selectedIndex
                                                            ? 'bg-accent text-accent-foreground'
                                                            : 'hover:bg-accent/50'
                                                    )}
                                                    onClick={() => handleResultClick(result)}
                                                >
                                                    <div className="flex-shrink-0 mt-1">
                                                        <Badge
                                                            className={cn(
                                                                'text-xs',
                                                                getRoleColor(result.message.role)
                                                            )}
                                                        >
                                                            {getRoleIcon(result.message.role)}
                                                        </Badge>
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-sm font-medium">
                                                                {result.sessionId.length > 20
                                                                    ? `${result.sessionId.slice(0, 20)}...`
                                                                    : result.sessionId}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {result.message.role}
                                                            </span>
                                                        </div>

                                                        <div className="text-sm text-muted-foreground line-clamp-2">
                                                            {highlightText(
                                                                result.context,
                                                                debouncedQuery
                                                            )}
                                                        </div>
                                                    </div>

                                                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : debouncedQuery ? (
                                        <div className="text-center py-12">
                                            <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                            <p className="text-muted-foreground">
                                                No messages found matching your search.
                                            </p>
                                            <p className="text-sm text-muted-foreground mt-2">
                                                Try different keywords.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="text-center py-12">
                                            <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                            <p className="text-muted-foreground">
                                                Start typing to search your conversations.
                                            </p>
                                            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <kbd className="px-2 py-1 bg-muted/50 rounded text-xs">
                                                        ↑
                                                    </kbd>
                                                    <kbd className="px-2 py-1 bg-muted/50 rounded text-xs">
                                                        ↓
                                                    </kbd>
                                                    <span>to navigate</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <kbd className="px-2 py-1 bg-muted/50 rounded text-xs">
                                                        Enter
                                                    </kbd>
                                                    <span>to select</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <kbd className="px-2 py-1 bg-muted/50 rounded text-xs">
                                                        Esc
                                                    </kbd>
                                                    <span>to close</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
