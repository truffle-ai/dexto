'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/api-url';
import { queryKeys } from '@/lib/queryKeys.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { 
  Search, 
  MessageSquare, 
  User, 
  Bot,
  Settings,
  Clock,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';

interface SearchResult {
  sessionId: string;
  message: {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
  };
  matchedText: string;
  context: string;
  messageIndex: number;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  hasMore: boolean;
  query: string;
}

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToSession: (sessionId: string, messageIndex?: number) => void;
}

export default function GlobalSearchModal({
  isOpen,
  onClose,
  onNavigateToSession
}: GlobalSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Debounce search query to avoid hammering the API
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300); // Wait 300ms after user stops typing

    return () => clearTimeout(timer); // Cancel timer if user types again
  }, [searchQuery]);

  // Use TanStack Query for search with debouncing
  const {
    data: searchResults = [],
    isLoading,
    error,
  } = useQuery<SearchResult[], Error>({
    queryKey: queryKeys.search.messages(debouncedQuery),
    queryFn: async () => {
      if (!debouncedQuery.trim()) {
        return [];
      }

      const params = new URLSearchParams({
        q: debouncedQuery,
        limit: '10',
        offset: '0'
      });

      const response = await fetch(`${getApiUrl()}/api/search/messages?${params}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Search failed: ${response.status} ${errorText}`);
      }
      
      const data: SearchResponse = await response.json();
      return data.results;
    },
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 5000, // Consider results fresh for 5 seconds
    gcTime: 30000, // Keep in cache for 30 seconds
  });

  const results = searchResults;
  const searchError = error?.message ?? null;

  const handleResultClick = useCallback((result: SearchResult) => {
    onNavigateToSession(result.sessionId, result.messageIndex);
    onClose();
  }, [onNavigateToSession, onClose]);

  // Reset when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setDebouncedQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keys when modal is open and focused
      if (!isOpen) return;

      // Don't handle the search shortcut here - let the parent handle it
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          if (results[selectedIndex]) {
            handleResultClick(results[selectedIndex]);
            setSelectedIndex(0);
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, onClose, handleResultClick]);

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
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 font-medium rounded px-1">
          {part}
        </mark>
      ) : part
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl p-0 top-[20%] transform translate-y-0">
        <DialogHeader>
          <DialogTitle className="sr-only">Search Conversations</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col max-h-[70vh]">
          {/* Search Header */}
          <div className="p-6 pb-4">
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
          <div className="flex-1 overflow-hidden border-t">
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
                  <p className="text-sm text-muted-foreground mt-2">{searchError}</p>
                  <p className="text-xs text-muted-foreground mt-2">Try again or check your connection.</p>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="p-2">
                  {results.length > 0 ? (
                    <div className="space-y-1">
                      {results.map((result, index) => (
                        <div
                          key={index}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                            index === selectedIndex 
                              ? "bg-accent text-accent-foreground" 
                              : "hover:bg-accent/50"
                          )}
                          onClick={() => handleResultClick(result)}
                        >
                          <div className="flex-shrink-0 mt-1">
                            <Badge className={cn("text-xs", getRoleColor(result.message.role))}>
                              {getRoleIcon(result.message.role)}
                            </Badge>
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">
                                {result.sessionId.length > 20 
                                  ? `${result.sessionId.slice(0, 20)}...`
                                  : result.sessionId
                                }
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {result.message.role}
                              </span>
                            </div>
                            
                            <div className="text-sm text-muted-foreground line-clamp-2">
                              {highlightText(result.context, debouncedQuery)}
                            </div>
                          </div>
                          
                          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                        </div>
                      ))}
                    </div>
                  ) : debouncedQuery ? (
                    <div className="text-center py-12">
                      <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">No messages found matching your search.</p>
                      <p className="text-sm text-muted-foreground mt-2">Try different keywords.</p>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">Start typing to search your conversations.</p>
                      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <kbd className="px-2 py-1 bg-muted rounded text-xs">↑</kbd>
                          <kbd className="px-2 py-1 bg-muted rounded text-xs">↓</kbd>
                          <span>to navigate</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <kbd className="px-2 py-1 bg-muted rounded text-xs">Enter</kbd>
                          <span>to select</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <kbd className="px-2 py-1 bg-muted rounded text-xs">Esc</kbd>
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
      </DialogContent>
    </Dialog>
  );
}
