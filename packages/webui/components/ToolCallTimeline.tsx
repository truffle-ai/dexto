import { useState, useEffect } from 'react';
import { ChevronRight, CheckCircle2, XCircle, Loader2, AlertCircle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { ToolResultRenderer } from './tool-renderers';
import type { ToolDisplayData } from '@dexto/core';

export interface ToolCallTimelineProps {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    success?: boolean;
    requireApproval?: boolean;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    /** Display data for rich tool result rendering */
    displayData?: ToolDisplayData;
    /** Callback when user approves (for pending approvals). rememberChoice=true to approve for entire session. */
    onApprove?: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    /** Callback when user rejects (for pending approvals) */
    onReject?: () => void;
}

/**
 * Strips tool name prefixes and returns clean display name
 * Formats: internal--toolName, custom--toolName, mcp--serverName--toolName
 */
function stripToolPrefix(toolName: string): {
    displayName: string;
    source: string;
    serverName?: string;
} {
    // Handle internal-- prefix
    if (toolName.startsWith('internal--')) {
        return { displayName: toolName.replace('internal--', ''), source: '' };
    }
    // Handle custom-- prefix
    if (toolName.startsWith('custom--')) {
        return { displayName: toolName.replace('custom--', ''), source: '' };
    }
    // Handle mcp--serverName--toolName format
    if (toolName.startsWith('mcp--')) {
        const parts = toolName.split('--');
        if (parts.length >= 3) {
            const serverName = parts[1];
            const cleanToolName = parts.slice(2).join('--');
            return { displayName: cleanToolName, source: serverName ?? '', serverName };
        }
        return { displayName: toolName.replace('mcp--', ''), source: 'mcp' };
    }
    // Legacy format with __ delimiter
    if (toolName.startsWith('mcp__')) {
        const parts = toolName.substring(5).split('__');
        if (parts.length >= 2) {
            return { displayName: parts.slice(1).join('__'), source: parts[0] ?? '' };
        }
        return { displayName: toolName.substring(5), source: 'mcp' };
    }
    if (toolName.startsWith('internal__')) {
        return { displayName: toolName.substring(10), source: '' };
    }
    // No prefix
    return { displayName: toolName, source: '' };
}

/**
 * Generates a user-friendly summary and extracts display info from tool name
 */
function getDisplayInfo(
    toolName: string,
    toolArgs?: Record<string, unknown>
): { summary: string; displayName: string; source: string } {
    const { displayName, source } = stripToolPrefix(toolName);

    // Generate smart summary based on tool type
    let summary = '';
    const args = toolArgs || {};

    if (
        displayName.includes('search') ||
        displayName.includes('query') ||
        displayName.includes('grep')
    ) {
        const query = args.query || args.q || args.search || args.pattern;
        summary = query
            ? `Searched for "${String(query).substring(0, 40)}${String(query).length > 40 ? '...' : ''}"`
            : 'Searched';
    } else if (
        displayName.includes('read') ||
        displayName.includes('Read') ||
        displayName.includes('fetch')
    ) {
        const path = args.path || args.file || args.url || args.file_path;
        summary = path ? `Read ${getShortPath(String(path))}` : 'Read file';
    } else if (
        displayName.includes('write') ||
        displayName.includes('Write') ||
        displayName.includes('create')
    ) {
        const path = args.path || args.file || args.file_path;
        summary = path ? `Created ${getShortPath(String(path))}` : 'Created file';
    } else if (
        displayName.includes('edit') ||
        displayName.includes('Edit') ||
        displayName.includes('update')
    ) {
        const path = args.path || args.file || args.file_path;
        summary = path ? `Updated ${getShortPath(String(path))}` : 'Updated file';
    } else if (displayName.includes('delete') || displayName.includes('remove')) {
        const path = args.path || args.file;
        summary = path ? `Deleted ${getShortPath(String(path))}` : 'Deleted';
    } else if (
        displayName.includes('list') ||
        displayName.includes('glob') ||
        displayName.includes('Glob')
    ) {
        const pattern = args.pattern || args.type || args.resource;
        summary = pattern ? `Listed ${String(pattern).substring(0, 30)}` : 'Listed items';
    } else if (
        displayName === 'Bash' ||
        displayName.includes('bash') ||
        displayName.includes('shell')
    ) {
        const cmd = args.command;
        summary = cmd
            ? `Ran ${String(cmd).substring(0, 40)}${String(cmd).length > 40 ? '...' : ''}`
            : 'Ran command';
    } else if (displayName === 'ask_user' || displayName.includes('AskUser')) {
        summary = 'Asked user for input';
    } else {
        // Fallback: humanize tool name
        const humanized = displayName
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .toLowerCase()
            .trim();
        summary = `Used ${humanized}`;
    }

    return { summary, displayName, source };
}

/**
 * Extracts just the filename or last 2 path segments
 */
function getShortPath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

export function ToolCallTimeline({
    toolName,
    toolArgs,
    toolResult,
    success,
    requireApproval = false,
    approvalStatus,
    displayData,
    onApprove,
    onReject,
}: ToolCallTimelineProps) {
    // Explicitly check if we have a result
    const hasResult = toolResult !== undefined;
    const isPendingApproval = requireApproval && approvalStatus === 'pending';

    // Expand by default for pending approvals so users can see what they're approving
    const [expanded, setExpanded] = useState(isPendingApproval);

    // Collapse after approval is resolved
    useEffect(() => {
        if (requireApproval && approvalStatus && approvalStatus !== 'pending') {
            setExpanded(false);
        }
    }, [requireApproval, approvalStatus]);

    const isProcessing = !hasResult && !isPendingApproval;

    const { summary, displayName, source } = getDisplayInfo(toolName, toolArgs);

    // Determine status icon and color based on state
    const getStatusIndicator = () => {
        if (isPendingApproval) {
            return (
                <div className="relative">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="absolute inset-0 h-3.5 w-3.5 rounded-full bg-amber-500/30 animate-ping" />
                </div>
            );
        }
        if (isProcessing) {
            return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
        }
        if (success !== false) {
            return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
        }
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    };

    return (
        <div className="flex gap-2 animate-slide-up my-0.5">
            {/* Status indicator */}
            <div className="flex-shrink-0 pt-0.5">{getStatusIndicator()}</div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                {/* Summary line - clickable to expand */}
                <button
                    onClick={() => (hasResult || isPendingApproval) && setExpanded(!expanded)}
                    disabled={!hasResult && !isPendingApproval}
                    className={cn(
                        'w-full flex items-center gap-1.5 text-left group',
                        (hasResult || isPendingApproval) && 'cursor-pointer'
                    )}
                >
                    <span
                        className={cn(
                            'text-xs font-medium',
                            isPendingApproval
                                ? 'text-amber-600 dark:text-amber-400'
                                : isProcessing
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : success !== false
                                    ? 'text-foreground/70'
                                    : 'text-destructive'
                        )}
                    >
                        {isPendingApproval
                            ? 'Requires approval'
                            : success === false
                              ? `Failed: ${summary}`
                              : summary}
                    </span>

                    {/* Approval status badges (for resolved approvals) */}
                    {requireApproval && approvalStatus === 'approved' && (
                        <span className="text-[10px] text-green-600 dark:text-green-500">
                            approved
                        </span>
                    )}
                    {requireApproval && approvalStatus === 'rejected' && (
                        <span className="text-[10px] text-destructive">rejected</span>
                    )}

                    {/* Source badge */}
                    {source && (
                        <span className="text-[10px] text-muted-foreground/60">[{source}]</span>
                    )}

                    {/* Expand chevron */}
                    {(hasResult || isPendingApproval) && (
                        <ChevronRight
                            className={cn(
                                'h-2.5 w-2.5 text-muted-foreground/40 transition-transform flex-shrink-0',
                                expanded && 'rotate-90'
                            )}
                        />
                    )}

                    {/* Processing text */}
                    {isProcessing && (
                        <span className="text-[10px] text-muted-foreground/50">processing...</span>
                    )}
                </button>

                {/* Tool name */}
                <div className="text-[11px] text-muted-foreground/70 mt-0.5 font-medium">
                    {displayName}
                </div>

                {/* Inline approval buttons (compact view, when not expanded) */}
                {isPendingApproval && !expanded && onApprove && onReject && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                onApprove(undefined, false);
                            }}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white h-6 text-[11px] px-2.5"
                        >
                            Approve
                        </Button>
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                onApprove(undefined, true);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] px-2.5 text-green-600 border-green-300 hover:bg-green-50 dark:border-green-700 dark:hover:bg-green-950/20"
                            title="Approve this tool for the rest of the session"
                        >
                            <Shield className="h-3 w-3 mr-1" />
                            Always
                        </Button>
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                onReject();
                            }}
                            variant="outline"
                            size="sm"
                            className="h-6 text-[11px] px-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                            Reject
                        </Button>
                    </div>
                )}

                {/* Expanded details */}
                {expanded && (hasResult || isPendingApproval) && (
                    <div className="mt-2 space-y-2 animate-fade-in">
                        {/* Tool arguments */}
                        {toolArgs && Object.keys(toolArgs).length > 0 && (
                            <div>
                                <h4 className="text-[9px] font-semibold text-muted-foreground/60 uppercase mb-1">
                                    Input
                                </h4>
                                <div className="bg-muted/30 rounded-md p-1.5 space-y-0.5 text-[10px]">
                                    {Object.entries(toolArgs).map(([key, value]) => (
                                        <div key={key} className="flex gap-1.5">
                                            <span className="text-muted-foreground font-medium shrink-0">
                                                {key}:
                                            </span>
                                            <span className="text-foreground/70 font-mono break-all">
                                                {formatValue(value)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Inline approval buttons (expanded view) */}
                        {isPendingApproval && onApprove && onReject && (
                            <div className="space-y-1.5">
                                <div className="flex gap-1.5">
                                    <Button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onApprove(undefined, false);
                                        }}
                                        size="sm"
                                        className="flex-1 bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                                    >
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Approve
                                    </Button>
                                    <Button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onReject();
                                        }}
                                        size="sm"
                                        variant="outline"
                                        className="flex-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 h-7 text-xs"
                                    >
                                        <XCircle className="h-3 w-3 mr-1" />
                                        Reject
                                    </Button>
                                </div>
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onApprove(undefined, true);
                                    }}
                                    size="sm"
                                    variant="outline"
                                    className="w-full h-6 text-[11px] text-green-600 border-green-300 hover:bg-green-50 dark:border-green-700 dark:hover:bg-green-950/20"
                                >
                                    <Shield className="h-3 w-3 mr-1" />
                                    Approve for entire session
                                </Button>
                            </div>
                        )}

                        {/* Tool result - use rich renderer if display data available */}
                        {hasResult && (
                            <div>
                                <h4 className="text-[9px] font-semibold text-muted-foreground/60 uppercase mb-1">
                                    Output
                                </h4>
                                <ToolResultRenderer
                                    display={displayData}
                                    content={toolResult}
                                    success={success}
                                    defaultExpanded={success === false}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function formatValue(value: unknown): string {
    if (typeof value === 'string') {
        // Truncate long strings
        return value.length > 200 ? `${value.substring(0, 200)}...` : value;
    }
    if (typeof value === 'object') {
        const str = JSON.stringify(value);
        return str.length > 200 ? `${str.substring(0, 200)}...` : str;
    }
    return String(value);
}
