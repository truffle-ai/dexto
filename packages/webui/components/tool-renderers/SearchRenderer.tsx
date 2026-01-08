/**
 * SearchRenderer Component
 *
 * Renders search results (grep, glob) with file:line format.
 * Shows pattern, match count, and individual results.
 */

import { useState } from 'react';
import { Search, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SearchDisplayData, SearchMatch } from '@dexto/core';

interface SearchRendererProps {
    /** Search display data from tool result */
    data: SearchDisplayData;
    /** Maximum matches to show before truncation (default: 5) */
    maxMatches?: number;
    /** Whether to start expanded (default: false) */
    defaultExpanded?: boolean;
}

/**
 * Extract relative path from full path.
 */
function getRelativePath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

/**
 * Renders a single search match result.
 */
function MatchResult({ match }: { match: SearchMatch }) {
    const { file, line, content } = match;

    return (
        <div className="flex items-start gap-2 py-0.5 group">
            <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span
                        className="font-mono text-[11px] text-blue-600 dark:text-blue-400 truncate"
                        title={file}
                    >
                        {getRelativePath(file)}
                    </span>
                    {line > 0 && <span className="text-[10px] text-muted-foreground">:{line}</span>}
                </div>
                {content && (
                    <div
                        className="font-mono text-[10px] text-foreground/60 truncate"
                        title={content}
                    >
                        {content.trim()}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Renders search results with collapsible match list.
 */
export function SearchRenderer({
    data,
    maxMatches = 5,
    defaultExpanded = false,
}: SearchRendererProps) {
    const { pattern, matches, totalMatches, truncated } = data;
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [showAll, setShowAll] = useState(false);

    const displayMatches = showAll ? matches : matches.slice(0, maxMatches);
    const hasMoreMatches = matches.length > maxMatches && !showAll;
    const wasServerTruncated = truncated;

    return (
        <div className="space-y-1.5">
            {/* Header with search info */}
            <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground/80">
                    <span className="font-medium">{totalMatches}</span>{' '}
                    {totalMatches === 1 ? 'match' : 'matches'} for{' '}
                    <code className="px-1 py-0.5 bg-muted rounded text-[11px]">{pattern}</code>
                </span>
                {wasServerTruncated && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        (truncated)
                    </span>
                )}
            </div>

            {/* Results section */}
            {matches.length > 0 && (
                <div className="pl-5">
                    {!expanded ? (
                        <button
                            onClick={() => setExpanded(true)}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ChevronRight className="h-3 w-3" />
                            <span>
                                Show {matches.length} result{matches.length !== 1 ? 's' : ''}
                            </span>
                        </button>
                    ) : (
                        <div className="space-y-1">
                            <button
                                onClick={() => setExpanded(false)}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <ChevronDown className="h-3 w-3" />
                                <span>Results</span>
                            </button>
                            <div
                                className={cn(
                                    'bg-muted/30 rounded-md p-2',
                                    'max-h-64 overflow-y-auto scrollbar-thin'
                                )}
                            >
                                {displayMatches.map((match, index) => (
                                    <MatchResult
                                        key={`${match.file}:${match.line}:${index}`}
                                        match={match}
                                    />
                                ))}
                                {hasMoreMatches && (
                                    <button
                                        onClick={() => setShowAll(true)}
                                        className="mt-2 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                                    >
                                        Show {matches.length - maxMatches} more results...
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* No results */}
            {matches.length === 0 && (
                <div className="pl-5 text-xs text-muted-foreground italic">No matches found</div>
            )}
        </div>
    );
}
