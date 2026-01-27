import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Zap, Plus } from 'lucide-react';
import { Badge } from './ui/badge';
import type { PromptInfo as CorePromptInfo } from '@dexto/core';
import { usePrompts } from './hooks/usePrompts';

// Use canonical types from @dexto/core for alignment
type PromptInfo = CorePromptInfo;

// PromptItem component for rendering individual prompts
const PromptItem = ({
    prompt,
    isSelected,
    onClick,
    onMouseEnter,
    dataIndex,
}: {
    prompt: Prompt;
    isSelected: boolean;
    onClick: () => void;
    onMouseEnter?: () => void;
    dataIndex?: number;
}) => (
    <div
        className={`px-3 py-2 cursor-pointer transition-colors ${
            isSelected ? 'bg-primary/20 ring-1 ring-primary/40' : 'hover:bg-primary/10'
        }`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        data-index={dataIndex}
    >
        <div className="flex items-start gap-2">
            <div className="flex-shrink-0 mt-0.5">
                {prompt.source === 'mcp' ? (
                    <Zap className="h-3 w-3 text-blue-400" />
                ) : prompt.source === 'config' ? (
                    <span className="text-xs">📋</span>
                ) : (
                    <Sparkles className="h-3 w-3 text-purple-400" />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {/* Command name with inline arguments */}
                    <div className="flex items-center gap-1">
                        {/* Use commandName (collision-resolved) for display, fall back to displayName/name */}
                        <span className="font-medium text-xs text-foreground">
                            /{prompt.commandName || prompt.displayName || prompt.name}
                        </span>
                        {prompt.arguments && prompt.arguments.length > 0 && (
                            <span className="flex items-center gap-1">
                                {prompt.arguments.map((arg) => (
                                    <span
                                        key={arg.name}
                                        className="group relative inline-block"
                                        title={arg.description || arg.name}
                                    >
                                        <span className="text-xs text-muted-foreground/70 hover:text-muted-foreground cursor-help transition-colors">
                                            &lt;{arg.name}
                                            {arg.required ? '' : '?'}&gt;
                                        </span>
                                        {/* Tooltip on hover */}
                                        {arg.description && (
                                            <span className="invisible group-hover:visible absolute left-0 top-full mt-1 z-50 px-2 py-1 text-[10px] bg-popover text-popover-foreground border border-border rounded shadow-lg whitespace-nowrap pointer-events-none">
                                                {arg.description}
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </span>
                        )}
                    </div>

                    {/* Source badges */}
                    {prompt.source === 'mcp' && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0.5 h-4">
                            MCP
                        </Badge>
                    )}
                    {prompt.source === 'config' && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0.5 h-4">
                            Config
                        </Badge>
                    )}
                    {prompt.source === 'custom' && (
                        <Badge
                            variant="outline"
                            className="text-xs px-1.5 py-0.5 h-4 bg-primary/10 text-primary border-primary/20"
                        >
                            Custom
                        </Badge>
                    )}
                </div>

                {/* Show title if available */}
                {prompt.title && (
                    <div className="text-xs font-medium text-foreground/90 mb-0.5">
                        {prompt.title}
                    </div>
                )}

                {/* Show description if available and different from title */}
                {prompt.description && prompt.description !== prompt.title && (
                    <div className="text-xs text-muted-foreground mb-1.5 line-clamp-2">
                        {prompt.description}
                    </div>
                )}
            </div>
        </div>
    </div>
);

// Define UI-specific Prompt interface extending core PromptInfo
interface Prompt extends PromptInfo {
    // UI-specific fields that may come from metadata
    starterPrompt?: boolean;
    category?: string;
    icon?: string;
    priority?: number;
}

interface SlashCommandAutocompleteProps {
    isVisible: boolean;
    searchQuery: string;
    onSelectPrompt: (prompt: Prompt) => void;
    onClose: () => void;
    onCreatePrompt?: () => void;
    refreshKey?: number;
}

export default function SlashCommandAutocomplete({
    isVisible,
    searchQuery,
    onSelectPrompt,
    onClose,
    onCreatePrompt,
    refreshKey,
}: SlashCommandAutocompleteProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedIndexRef = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const lastRefreshKeyRef = useRef<number>(0);

    // Fetch prompts using TanStack Query
    const { data: prompts = [], isLoading, refetch } = usePrompts({ enabled: isVisible });

    // Keep the latest selected index accessible in callbacks without needing extra effect deps
    selectedIndexRef.current = selectedIndex;

    // Refetch when refreshKey changes
    useEffect(() => {
        if (!isVisible) return;
        const effectiveKey = refreshKey ?? 0;
        if (effectiveKey > 0 && effectiveKey !== lastRefreshKeyRef.current) {
            refetch();
            lastRefreshKeyRef.current = effectiveKey;
        }
    }, [isVisible, refreshKey, refetch]);

    // Filter prompts based on search query - memoized to avoid infinite loops
    const filteredPrompts = React.useMemo(() => {
        if (!searchQuery.trim() || searchQuery === '/') {
            return prompts;
        }

        // Extract just the command name (first word after /) for filtering
        // E.g., "/summarize technical 100 'text'" -> "summarize"
        const withoutSlash = searchQuery.startsWith('/') ? searchQuery.slice(1) : searchQuery;
        const commandName = withoutSlash.split(/\s+/)[0] || '';

        return prompts.filter(
            (prompt) =>
                prompt.name.toLowerCase().includes(commandName.toLowerCase()) ||
                (prompt.description &&
                    prompt.description.toLowerCase().includes(commandName.toLowerCase())) ||
                (prompt.title && prompt.title.toLowerCase().includes(commandName.toLowerCase()))
        );
    }, [searchQuery, prompts]);

    const showCreateOption = React.useMemo(() => {
        const trimmed = searchQuery.trim();
        if (!trimmed) return false;
        if (trimmed === '/') return true;
        if (trimmed.startsWith('/') && filteredPrompts.length === 0) return true;
        return false;
    }, [searchQuery, filteredPrompts.length]);

    const combinedItems = React.useMemo(() => {
        const items: Array<{ kind: 'create' } | { kind: 'prompt'; prompt: Prompt }> = [];
        if (showCreateOption) {
            items.push({ kind: 'create' });
        }
        filteredPrompts.forEach((prompt) => items.push({ kind: 'prompt', prompt }));
        return items;
    }, [showCreateOption, filteredPrompts]);

    // Note: mcp:prompts-list-changed DOM listener removed (was dead code - never dispatched as DOM event)
    // Prompts are refreshed via React Query's built-in mechanisms when needed

    // Reset selected index when filtered results change
    useEffect(() => {
        const shouldShowCreate = searchQuery === '/';
        const defaultIndex = shouldShowCreate && filteredPrompts.length > 0 ? 1 : 0;
        setSelectedIndex(defaultIndex);
    }, [searchQuery, filteredPrompts.length]);

    const itemsLength = combinedItems.length;

    useEffect(() => {
        setSelectedIndex((prevIndex) => {
            if (itemsLength === 0) {
                return 0;
            }

            if (prevIndex >= itemsLength) {
                return itemsLength - 1;
            }

            return prevIndex;
        });
    }, [itemsLength]);

    // Handle keyboard navigation
    useEffect(() => {
        if (!isVisible) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const items = combinedItems;
            const stop = () => {
                e.preventDefault();
                e.stopPropagation();
                // Some environments support stopImmediatePropagation on DOM events
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            };

            // Check if user has typed arguments after the command name
            // E.g., "/summarize technical 100 'text'" -> has arguments, so Enter should submit
            const withoutSlash = searchQuery.startsWith('/') ? searchQuery.slice(1) : searchQuery;
            const parts = withoutSlash.split(/\s+/);
            const hasArguments =
                parts.length > 1 && parts.slice(1).some((p) => p.trim().length > 0);

            switch (e.key) {
                case 'ArrowDown':
                    if (items.length === 0) return;
                    stop();
                    setSelectedIndex((prev) => (prev + 1) % items.length);
                    break;
                case 'ArrowUp':
                    if (items.length === 0) return;
                    stop();
                    setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
                    break;
                case 'Enter':
                    // If user has typed arguments, let Enter pass through to submit the message
                    if (hasArguments) {
                        return; // Don't intercept - let InputArea handle submission
                    }
                    stop();
                    if (items.length === 0) {
                        onCreatePrompt?.();
                        return;
                    }
                    {
                        const item = items[selectedIndexRef.current];
                        if (item.kind === 'create') {
                            onCreatePrompt?.();
                        } else {
                            onSelectPrompt(item.prompt);
                        }
                    }
                    break;
                case 'Escape':
                    stop();
                    onClose();
                    break;
                case 'Tab':
                    stop();
                    if (items.length === 0) {
                        onCreatePrompt?.();
                        return;
                    }
                    {
                        const item = items[selectedIndexRef.current];
                        if (item.kind === 'create') {
                            onCreatePrompt?.();
                        } else {
                            onSelectPrompt(item.prompt);
                        }
                    }
                    break;
            }
        };

        // Use capture phase so we can intercept Enter before input handlers stop propagation
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [isVisible, combinedItems, onSelectPrompt, onClose, onCreatePrompt, searchQuery]);

    // Scroll selected item into view when selectedIndex changes
    useEffect(() => {
        if (!scrollContainerRef.current) return;

        const scrollContainer = scrollContainerRef.current;
        const selectedItem = scrollContainer.querySelector(
            `[data-index="${selectedIndex}"]`
        ) as HTMLElement;

        if (selectedItem) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const itemRect = selectedItem.getBoundingClientRect();

            // Check if item is visible in container
            const isAbove = itemRect.top < containerRect.top;
            const isBelow = itemRect.bottom > containerRect.bottom;

            if (isAbove || isBelow) {
                selectedItem.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                });
            }
        }
    }, [selectedIndex]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isVisible) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isVisible, onClose]);

    if (!isVisible) return null;

    return (
        <div
            ref={containerRef}
            className="absolute left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-lg max-h-96 overflow-hidden z-[9999]"
            style={{
                position: 'absolute',
                bottom: 'calc(100% + 0px)',
                left: 0,
                right: 0,
                borderRadius: '8px',
                maxHeight: '320px',
                overflow: 'visible',
                zIndex: 9999,
                minWidth: '400px',
                // Custom dark styling
                background:
                    'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)',
                border: '1px solid hsl(var(--border) / 0.3)',
                backdropFilter: 'blur(8px)',
                boxShadow:
                    '0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            }}
        >
            {/* Header - Compact with prompt count */}
            <div className="px-3 py-2 border-b border-border bg-muted/50">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span>Available Prompts (hover over arguments for more info)</span>
                    <Badge variant="secondary" className="ml-auto text-xs px-2 py-0.5">
                        {prompts.length}
                    </Badge>
                </div>
            </div>

            {/* Prompts List */}
            <div ref={scrollContainerRef} className="max-h-48 overflow-y-auto">
                {isLoading ? (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                        Loading prompts...
                    </div>
                ) : (
                    <>
                        {showCreateOption && (
                            <div
                                className={`px-3 py-2 cursor-pointer transition-colors ${
                                    selectedIndex === 0
                                        ? 'bg-primary/20 ring-1 ring-primary/40'
                                        : 'hover:bg-primary/10'
                                }`}
                                onClick={() => onCreatePrompt?.()}
                                onMouseEnter={() => setSelectedIndex(0)}
                                data-index={0}
                            >
                                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                                    <Plus className="h-3 w-3 text-primary" />
                                    <span>Create new prompt</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-1">
                                    Define a reusable prompt. Press Enter to continue.
                                </div>
                            </div>
                        )}

                        {filteredPrompts.length === 0
                            ? !showCreateOption && (
                                  <div className="p-3 text-center text-xs text-muted-foreground">
                                      No prompts available.
                                  </div>
                              )
                            : filteredPrompts.map((prompt, index) => {
                                  const itemIndex = showCreateOption ? index + 1 : index;
                                  return (
                                      <PromptItem
                                          key={prompt.name}
                                          prompt={prompt}
                                          isSelected={itemIndex === selectedIndex}
                                          onClick={() => onSelectPrompt(prompt)}
                                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                                          dataIndex={itemIndex}
                                      />
                                  );
                              })}
                    </>
                )}
            </div>

            {/* Footer - Compact with navigation hints */}
            <div className="px-2 py-1.5 border-t border-border bg-muted/20 text-xs text-muted-foreground text-center">
                <span>↑↓ Navigate • Tab/Enter Select • Esc Close</span>
            </div>
        </div>
    );
}
