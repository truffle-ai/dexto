'use client';

import React from 'react';
import { Wrench, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { McpTool, McpServer } from '@/types';

interface ToolsListProps {
  tools: McpTool[];
  selectedTool: McpTool | null;
  selectedServer: McpServer | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToolSelect: (tool: McpTool) => void;
}

export function ToolsList({
  tools,
  selectedTool,
  selectedServer,
  isLoading,
  error,
  searchQuery,
  onSearchChange,
  onToolSelect,
}: ToolsListProps) {
  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="pb-3 mb-3 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Tools</h2>
          {isLoading && tools.length === 0 && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
          {tools.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {filteredTools.length}
            </Badge>
          )}
        </div>

        {tools.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 text-sm pl-7"
            />
          </div>
        )}
      </div>

      {/* No Server Selected */}
      {!selectedServer && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Wrench className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Select a server</p>
            <p className="text-xs text-muted-foreground mt-1">Choose a connected server to view its tools</p>
          </div>
        </div>
      )}

      {/* Server Not Connected */}
      {selectedServer && selectedServer.status !== 'connected' && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Wrench className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Server not connected</p>
            <p className="text-xs text-muted-foreground mt-1">
              "{selectedServer.name}" is {selectedServer.status}
            </p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && selectedServer?.status === 'connected' && !isLoading && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
          <p className="font-medium">Error loading tools</p>
          <p className="text-xs mt-1">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && selectedServer?.status === 'connected' && tools.length === 0 && (
        <div className="flex-1 space-y-2 pr-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-3 rounded-lg border border-border">
              <div className="flex items-start gap-2">
                <Skeleton className="h-4 w-4 mt-0.5 flex-shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {selectedServer &&
        selectedServer.status === 'connected' &&
        !isLoading &&
        tools.length === 0 &&
        !error && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center">
              <Wrench className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No tools available</p>
              <p className="text-xs text-muted-foreground mt-1">
                No tools found for {selectedServer.name}
              </p>
            </div>
          </div>
        )}

      {/* Tools List */}
      {filteredTools.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {filteredTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => onToolSelect(tool)}
              className={cn(
                'w-full p-3 rounded-lg text-left transition-all duration-200',
                'hover:shadow-sm border border-transparent',
                selectedTool?.id === tool.id
                  ? 'bg-primary text-primary-foreground shadow-sm border-primary/20'
                  : 'hover:bg-muted hover:border-border'
              )}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm truncate">{tool.name}</h3>
                  {tool.description && (
                    <p
                      className={cn(
                        'text-xs mt-1 line-clamp-2',
                        selectedTool?.id === tool.id
                          ? 'text-primary-foreground/80'
                          : 'text-muted-foreground'
                      )}
                    >
                      {tool.description}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No Search Results */}
      {filteredTools.length === 0 && tools.length > 0 && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Search className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No tools match your search</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
          </div>
        </div>
      )}
    </div>
  );
}
