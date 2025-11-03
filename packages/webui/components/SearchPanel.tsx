'use client';

import React, { useState, useCallback } from 'react';
import { useDebounce } from 'use-debounce';
import { getApiUrl } from '@/lib/api-url';
import { apiFetch } from '@/lib/api-client.js';
import { formatDate, formatTime } from '@/lib/date-utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import {
  Search,
  MessageSquare,
  Clock,
  User,
  Bot,
  Settings,
  X,
  ArrowLeft,
  ChevronRight,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from './ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

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

interface SessionSearchResult {
  sessionId: string;
  matchCount: number;
  firstMatch: SearchResult;
  metadata: {
    createdAt: number;
    lastActivity: number;
    messageCount: number;
  };
}

interface SessionSearchResponse {
  results: SessionSearchResult[];
  total: number;
  hasMore: boolean;
  query: string;
}

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToSession: (sessionId: string, messageIndex?: number) => void;
  variant?: 'inline' | 'modal';
}

type SearchMode = 'messages' | 'sessions';

export default function SearchPanel({ 
  isOpen, 
  onClose, 
  onNavigateToSession,
  variant = 'modal'
}: SearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery] = useDebounce(searchQuery, 300);
  const [searchMode, setSearchMode] = useState<SearchMode>('messages');
  const [messageResults, setMessageResults] = useState<SearchResult[]>([]);
  const [sessionResults, setSessionResults] = useState<SessionSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sessionFilter, setSessionFilter] = useState<string>('');
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const performSearch = useCallback(async (query: string, mode: SearchMode) => {
    if (!query.trim()) {
      setMessageResults([]);
      setSessionResults([]);
      setTotal(0);
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'messages') {
        const params = new URLSearchParams({
          q: query,
          limit: '20',
          offset: '0'
        });

        if (roleFilter !== 'all') {
          params.append('role', roleFilter);
        }

        if (sessionFilter) {
          params.append('sessionId', sessionFilter);
        }

        const data = await apiFetch<SearchResponse>(`/api/search/messages?${params}`);
        setMessageResults(data.results);
        setTotal(data.total);
        setHasMore(data.hasMore);
      } else {
        const params = new URLSearchParams({ q: query });
        const data = await apiFetch<SessionSearchResponse>(`/api/search/sessions?${params}`);
        setSessionResults(data.results);
        setTotal(data.total);
        setHasMore(data.hasMore);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsLoading(false);
    }
  }, [roleFilter, sessionFilter]);

  // Perform search when debounced query changes
  React.useEffect(() => {
    performSearch(debouncedQuery, searchMode);
  }, [debouncedQuery, searchMode, performSearch]);

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
      ) : part
    );
  };

  const content = (
    <div className={cn(
      "flex flex-col h-full",
      variant === 'modal' && "min-h-[600px]"
    )}>
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
              <AlertDescription>{error}</AlertDescription>
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
                      <>Found {total} {searchMode === 'messages' ? 'messages' : 'sessions'} matching "{searchQuery}"</>
                    ) : (
                      <>No {searchMode === 'messages' ? 'messages' : 'sessions'} found matching "{searchQuery}"</>
                    )}
                  </div>
                )}

                {/* Message Results */}
                {searchMode === 'messages' && messageResults.length > 0 && (
                  <div className="space-y-2">
                    {messageResults.map((result, index) => (
                      <div
                        key={index}
                        className="p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer"
                        onClick={() => handleResultClick(result)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={cn("text-xs", getRoleColor(result.message.role))}>
                              {getRoleIcon(result.message.role)}
                              <span className="ml-1 capitalize">{result.message.role}</span>
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              Session: {result.sessionId.slice(0, 8)}...
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                        
                        <div className="text-sm">
                          {highlightText(result.context, searchQuery)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Session Results */}
                {searchMode === 'sessions' && sessionResults.length > 0 && (
                  <div className="space-y-2">
                    {sessionResults.map((sessionResult, index) => (
                      <div
                        key={index}
                        className="p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer"
                        onClick={() => handleSessionResultClick(sessionResult)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">
                              {sessionResult.sessionId.slice(0, 12)}...
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {sessionResult.matchCount} matches
                            </Badge>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                        
                        <div className="text-sm text-muted-foreground mb-2">
                          {sessionResult.metadata.messageCount} messages • 
                          Created {formatDate(sessionResult.metadata.createdAt)} • 
                          Last active {formatTime(sessionResult.metadata.lastActivity)}
                        </div>
                        
                        <div className="text-sm">
                          {highlightText(sessionResult.firstMatch.context, searchQuery)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* No Results */}
                {searchQuery && !isLoading && (
                  searchMode === 'messages' ? messageResults.length === 0 : sessionResults.length === 0
                ) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No {searchMode === 'messages' ? 'messages' : 'sessions'} found matching your search.</p>
                    <p className="text-sm mt-2">Try adjusting your search terms or filters.</p>
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
    return (
      <div className="h-full flex flex-col">
        {content}
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl h-[80vh] p-0">
        {content}
      </DialogContent>
    </Dialog>
  );
}
