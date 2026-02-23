import { useState, useEffect } from 'react';
import {
    ChevronRight,
    CheckCircle2,
    XCircle,
    Loader2,
    AlertCircle,
    Shield,
    FileText,
    FileEdit,
    FilePlus,
    Trash2,
    Terminal,
    Search,
    Copy,
    Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { CodePreview } from './CodePreview';
import type { ToolDisplayData, ToolPresentationSnapshotV1 } from '@dexto/core';

/**
 * Sub-agent progress data for spawn_agent tool calls
 */
export interface SubAgentProgress {
    task: string;
    agentId: string;
    toolsCalled: number;
    currentTool: string;
    currentArgs?: Record<string, unknown>;
}

export interface ToolCallTimelineProps {
    toolName: string;
    presentationSnapshot?: ToolPresentationSnapshotV1;
    toolArgs?: Record<string, unknown>;
    toolResult?: unknown;
    success?: boolean;
    requireApproval?: boolean;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    displayData?: ToolDisplayData;
    subAgentProgress?: SubAgentProgress;
    onApprove?: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onReject?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function stripToolPrefix(toolName: string): { displayName: string; source: string } {
    if (toolName.startsWith('mcp--')) {
        const parts = toolName.split('--');
        if (parts.length >= 3) {
            return { displayName: parts.slice(2).join('--'), source: parts[1] ?? '' };
        }
        return { displayName: toolName.replace('mcp--', ''), source: 'mcp' };
    }
    return { displayName: toolName, source: '' };
}

function getShortPath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function getSummary(
    displayName: string,
    toolArgs?: Record<string, unknown>
): { name: string; detail?: string } {
    const args = toolArgs || {};
    const filePath = (args.file_path || args.path || args.file) as string | undefined;
    const command = args.command as string | undefined;
    const pattern = (args.pattern || args.query) as string | undefined;

    if (command) {
        return { name: displayName, detail: truncate(command, 40) };
    }
    if (filePath) {
        return { name: displayName, detail: getShortPath(filePath) };
    }
    if (pattern) {
        return { name: displayName, detail: `"${truncate(pattern, 25)}"` };
    }
    return { name: displayName };
}

// =============================================================================
// Main Component
// =============================================================================

export function ToolCallTimeline({
    toolName,
    presentationSnapshot,
    toolArgs,
    toolResult,
    success,
    requireApproval = false,
    approvalStatus,
    displayData,
    subAgentProgress,
    onApprove,
    onReject,
}: ToolCallTimelineProps) {
    const hasResult = toolResult !== undefined;
    const isPendingApproval = requireApproval && approvalStatus === 'pending';
    const isFailed = success === false;
    const isRejected = approvalStatus === 'rejected';
    // Tool is processing only if: no result yet, not pending approval, and not marked as failed
    // The `success === false` check handles incomplete tool calls from history (never got a result)
    const isProcessing = !hasResult && !isPendingApproval && !isFailed;
    const hasSubAgentProgress = !!subAgentProgress;

    // Determine if there's meaningful content to show
    const hasExpandableContent = Boolean(
        displayData ||
            toolArgs?.content ||
            (toolArgs?.old_string && toolArgs?.new_string) ||
            (toolArgs?.command && hasResult)
    );

    // Determine if this tool has rich UI that should be shown by default
    // Rich UI includes: displayData, file content previews, and diff views
    // Exclude bash commands as they're more variable in visual value
    const hasRichUI = Boolean(
        displayData || toolArgs?.content || (toolArgs?.old_string && toolArgs?.new_string)
    );

    // Smart default: expand for pending approvals and successful tools with rich UI
    // Failed, rejected, and no-output should always be collapsed
    const [expanded, setExpanded] = useState(
        isPendingApproval || (hasRichUI && !isFailed && !isRejected)
    );
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    // Auto-collapse after approval is resolved, but keep open if tool has rich UI and succeeded
    useEffect(() => {
        if (requireApproval && approvalStatus && approvalStatus !== 'pending') {
            // Collapse if rejected or if no rich UI to show
            if (isRejected || !hasRichUI) {
                setExpanded(false);
            }
        }
    }, [requireApproval, approvalStatus, hasRichUI, isRejected]);

    const { displayName: fallbackDisplayName, source: fallbackSource } = stripToolPrefix(toolName);
    const displayName = presentationSnapshot?.header?.title ?? fallbackDisplayName;
    const source = (() => {
        const snapshotSource = presentationSnapshot?.source;
        if (snapshotSource?.type === 'mcp') {
            return snapshotSource.mcpServerName ?? (fallbackSource || 'mcp');
        }
        return fallbackSource;
    })();
    const summary = (() => {
        const argsText = presentationSnapshot?.header?.argsText;
        if (typeof argsText === 'string' && argsText.length > 0) {
            return { name: displayName, detail: argsText };
        }
        return getSummary(displayName, toolArgs);
    })();

    // For sub-agent progress, format the agent name nicely
    const subAgentLabel = hasSubAgentProgress
        ? subAgentProgress.agentId
              .replace(/-agent$/, '')
              .charAt(0)
              .toUpperCase() + subAgentProgress.agentId.replace(/-agent$/, '').slice(1)
        : null;

    // Status icon
    const StatusIcon = isPendingApproval ? (
        <div className="relative">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
            <span className="absolute inset-0 rounded-full bg-amber-500/30 animate-ping" />
        </div>
    ) : isProcessing ? (
        <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
    ) : isFailed || isRejected ? (
        <XCircle className="h-3.5 w-3.5 text-red-500" />
    ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    );

    // Header click handler
    const toggleExpanded = () => {
        if (hasResult || isPendingApproval || hasExpandableContent) {
            setExpanded(!expanded);
        }
    };

    const canExpand = hasResult || isPendingApproval || hasExpandableContent;

    return (
        <div
            className={cn(
                'my-0.5 rounded-md transition-colors inline-block max-w-full',
                isPendingApproval &&
                    'bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30'
            )}
        >
            {/* Collapsed Header - Always Visible */}
            <button
                onClick={toggleExpanded}
                disabled={!canExpand}
                className={cn(
                    'inline-flex items-center gap-2 p-1.5 text-left rounded-md',
                    canExpand && 'hover:bg-muted/40 cursor-pointer',
                    !canExpand && 'cursor-default'
                )}
            >
                {/* Status icon */}
                <div className="flex-shrink-0">{StatusIcon}</div>

                {/* Summary text */}
                <span
                    className={cn(
                        'text-xs flex-1 truncate',
                        isPendingApproval && 'text-amber-700 dark:text-amber-300 font-medium',
                        isProcessing && 'text-blue-600 dark:text-blue-400',
                        isFailed && 'text-red-600 dark:text-red-400',
                        isRejected && 'text-red-600 dark:text-red-400',
                        !isPendingApproval &&
                            !isProcessing &&
                            !isFailed &&
                            !isRejected &&
                            'text-foreground/70'
                    )}
                >
                    {isPendingApproval ? 'Approval required: ' : ''}
                    {isFailed ? 'Failed: ' : ''}
                    {isRejected ? 'Rejected: ' : ''}
                    {hasSubAgentProgress ? (
                        <span className="font-mono">
                            <span className="text-purple-600 dark:text-purple-400 font-medium">
                                {subAgentLabel}
                            </span>
                            <span className="text-muted-foreground/50">(</span>
                            <span className="text-foreground/80">{subAgentProgress.task}</span>
                            <span className="text-muted-foreground/50">)</span>
                        </span>
                    ) : (
                        <span className="font-mono">
                            <span className="text-blue-600 dark:text-blue-400">
                                {summary.name.toLowerCase()}
                            </span>
                            <span className="text-muted-foreground/50">(</span>
                            {summary.detail && (
                                <span className="text-foreground/80">{summary.detail}</span>
                            )}
                            <span className="text-muted-foreground/50">)</span>
                        </span>
                    )}
                </span>

                {/* Badges */}
                {source && (
                    <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                        [{source}]
                    </span>
                )}
                {requireApproval && approvalStatus === 'approved' && (
                    <span className="text-[10px] text-green-600 dark:text-green-500 flex-shrink-0">
                        approved
                    </span>
                )}
                {isProcessing && !hasSubAgentProgress && (
                    <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                        running...
                    </span>
                )}

                {/* Sub-agent progress indicator */}
                {hasSubAgentProgress && isProcessing && (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {subAgentProgress.toolsCalled} tool
                        {subAgentProgress.toolsCalled !== 1 ? 's' : ''} |{' '}
                        {subAgentProgress.currentTool}
                    </span>
                )}

                {/* Expand chevron */}
                {canExpand && (
                    <ChevronRight
                        className={cn(
                            'h-3 w-3 text-muted-foreground/40 flex-shrink-0 transition-transform',
                            expanded && 'rotate-90'
                        )}
                    />
                )}
            </button>

            {/* Expanded Content */}
            {expanded && (
                <div className="px-1.5 pb-2 pt-1 space-y-2 animate-fade-in">
                    {/* Pending Approval Content */}
                    {isPendingApproval && (
                        <>
                            {renderApprovalPreview()}
                            <div className="flex gap-1.5 flex-wrap pt-1">
                                <Button
                                    onClick={() => onApprove?.(undefined, false)}
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700 text-white h-6 text-[11px] px-2.5"
                                >
                                    Approve
                                </Button>
                                <Button
                                    onClick={() => onApprove?.(undefined, true)}
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[11px] px-2 text-green-600 border-green-300 hover:bg-green-50 dark:border-green-700 dark:hover:bg-green-950/20"
                                >
                                    <Shield className="h-3 w-3 mr-1" />
                                    Always
                                </Button>
                                <Button
                                    onClick={() => onReject?.()}
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-[11px] px-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                                >
                                    Reject
                                </Button>
                            </div>
                        </>
                    )}

                    {/* Error Content */}
                    {isFailed && hasResult && renderErrorContent()}

                    {/* Result Content */}
                    {hasResult && !isFailed && !isPendingApproval && renderResultContent()}
                </div>
            )}
        </div>
    );

    // =========================================================================
    // Render Functions
    // =========================================================================

    function renderApprovalPreview() {
        const command = toolArgs?.command as string | undefined;
        const filePath = (toolArgs?.file_path || toolArgs?.path) as string | undefined;
        const content = toolArgs?.content as string | undefined;
        const oldString = toolArgs?.old_string as string | undefined;
        const newString = toolArgs?.new_string as string | undefined;

        // Bash command
        if (command) {
            return (
                <div className="ml-5 bg-zinc-900 rounded overflow-hidden">
                    <pre className="px-2 py-1.5 text-[11px] text-zinc-300 font-mono whitespace-pre-wrap">
                        <span className="text-zinc-500">$ </span>
                        {command}
                    </pre>
                </div>
            );
        }

        // Edit operation - diff view without header (file path is in summary)
        if (oldString !== undefined && newString !== undefined) {
            return (
                <div className="ml-5 bg-muted/30 rounded overflow-hidden border border-border/50 text-[11px] font-mono">
                    {oldString
                        .split('\n')
                        .slice(0, detailsExpanded ? 15 : 3)
                        .map((line, i) => (
                            <div
                                key={`o${i}`}
                                className="px-2 py-0.5 bg-red-100/50 dark:bg-red-900/20 text-red-800 dark:text-red-300"
                            >
                                <span className="text-red-500/50 mr-1">-</span>
                                {line || ' '}
                            </div>
                        ))}
                    {newString
                        .split('\n')
                        .slice(0, detailsExpanded ? 15 : 3)
                        .map((line, i) => (
                            <div
                                key={`n${i}`}
                                className="px-2 py-0.5 bg-green-100/50 dark:bg-green-900/20 text-green-800 dark:text-green-300"
                            >
                                <span className="text-green-500/50 mr-1">+</span>
                                {line || ' '}
                            </div>
                        ))}
                    {(oldString.split('\n').length > 3 || newString.split('\n').length > 3) && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setDetailsExpanded(!detailsExpanded);
                            }}
                            className="w-full py-0.5 text-[10px] text-blue-500 bg-muted/50 border-t border-border/30"
                        >
                            {detailsExpanded ? 'less' : 'more...'}
                        </button>
                    )}
                </div>
            );
        }

        // Write/Create file
        if (content && filePath) {
            return (
                <div className="ml-5">
                    <CodePreview
                        content={content}
                        filePath={filePath}
                        maxLines={8}
                        maxHeight={180}
                        showHeader={false}
                    />
                </div>
            );
        }

        return null;
    }

    function renderErrorContent() {
        let errorMessage = 'Unknown error';
        if (toolResult && typeof toolResult === 'object') {
            const result = toolResult as Record<string, unknown>;
            if (result.content && Array.isArray(result.content)) {
                const textPart = result.content.find(
                    (p: unknown) =>
                        typeof p === 'object' &&
                        p !== null &&
                        (p as Record<string, unknown>).type === 'text'
                ) as { text?: string } | undefined;
                if (textPart?.text) errorMessage = textPart.text;
            } else if (result.error) {
                errorMessage =
                    typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
            }
        }

        return (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded px-2 py-1.5">
                <pre className="text-[11px] text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-all">
                    {truncate(errorMessage, 500)}
                </pre>
            </div>
        );
    }

    function renderResultContent() {
        // Extract toolArgs for checking rich content availability
        const command = toolArgs?.command as string | undefined;
        const filePath = (toolArgs?.file_path || toolArgs?.path) as string | undefined;
        const content = toolArgs?.content as string | undefined;
        const oldString = toolArgs?.old_string as string | undefined;
        const newString = toolArgs?.new_string as string | undefined;

        // Check if we have rich content that should override simple displayData
        const hasRichContent = !!(
            content ||
            (oldString !== undefined && newString !== undefined) ||
            (command && hasResult)
        );

        // If we have display metadata from tool, use it (unless we have richer content)
        if (displayData) {
            // Skip simple file metadata display if we have rich content to show
            if (displayData.type === 'file' && hasRichContent) {
                // Fall through to render rich content below
            } else {
                switch (displayData.type) {
                    case 'diff':
                        return renderDiff(displayData);
                    case 'shell':
                        return renderShell(displayData);
                    case 'search':
                        return renderSearch(displayData);
                    case 'file':
                        return renderFile(displayData);
                }
            }
        }

        // Render rich content from toolArgs
        // Bash command with result
        if (command && hasResult) {
            return renderBashResult(command);
        }

        // Edit operation (old_string -> new_string)
        if (oldString !== undefined && newString !== undefined && filePath) {
            return renderEditResult(filePath, oldString, newString);
        }

        // Write/create file
        if (content && filePath) {
            return renderWriteResult(filePath, content);
        }

        // Read file - show content from result
        if (displayName.toLowerCase().includes('read') && filePath) {
            return renderReadResult(filePath);
        }

        // Fallback to generic
        return renderGenericResult();
    }

    function renderDiff(data: Extract<ToolDisplayData, { type: 'diff' }>) {
        const lines = data.unified
            .split('\n')
            .filter((l) => !l.startsWith('@@') && !l.startsWith('---') && !l.startsWith('+++'));
        const displayLines = lines.slice(0, detailsExpanded ? 40 : 8);

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                    <FileEdit className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-foreground/70">
                        {getShortPath(data.filename)}
                    </span>
                    <span className="text-green-600">+{data.additions}</span>
                    <span className="text-red-600">-{data.deletions}</span>
                </div>
                <div className="bg-muted/30 rounded overflow-hidden border border-border/50">
                    {displayLines.map((line, i) => {
                        const isAdd = line.startsWith('+');
                        const isDel = line.startsWith('-');
                        return (
                            <div
                                key={i}
                                className={cn(
                                    'px-2 py-0.5 text-[11px] font-mono',
                                    isAdd &&
                                        'bg-green-100/50 dark:bg-green-900/20 text-green-800 dark:text-green-300',
                                    isDel &&
                                        'bg-red-100/50 dark:bg-red-900/20 text-red-800 dark:text-red-300',
                                    !isAdd && !isDel && 'text-foreground/50'
                                )}
                            >
                                <span className="mr-1 opacity-50">
                                    {isAdd ? '+' : isDel ? '-' : ' '}
                                </span>
                                {line.slice(1) || ' '}
                            </div>
                        );
                    })}
                    {lines.length > 8 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setDetailsExpanded(!detailsExpanded);
                            }}
                            className="w-full py-0.5 text-[10px] text-blue-500 bg-muted/50 border-t border-border/30"
                        >
                            {detailsExpanded ? 'less' : `+${lines.length - 8} more...`}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    function renderShell(data: Extract<ToolDisplayData, { type: 'shell' }>) {
        const output = data.stdout || data.stderr || '';
        const lines = output.split('\n');
        const displayLines = lines.slice(0, detailsExpanded ? 25 : 5);
        const isError = data.exitCode !== 0;

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                    <Terminal className="h-3 w-3 text-muted-foreground" />
                    <code className="font-mono text-foreground/70 truncate flex-1">
                        {truncate(data.command, 50)}
                    </code>
                    <span
                        className={cn(
                            'text-[10px] px-1 py-0.5 rounded',
                            isError
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-600'
                                : 'bg-green-100 dark:bg-green-900/30 text-green-600'
                        )}
                    >
                        {isError ? `exit ${data.exitCode}` : 'ok'}
                    </span>
                    <button
                        onClick={async (e) => {
                            e.stopPropagation();
                            await navigator.clipboard.writeText(data.command);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        {copied ? (
                            <Check className="h-3 w-3 text-green-500" />
                        ) : (
                            <Copy className="h-3 w-3" />
                        )}
                    </button>
                </div>
                {output && (
                    <div className="bg-zinc-100 dark:bg-zinc-900 rounded overflow-hidden border border-zinc-200 dark:border-zinc-800">
                        <pre className="p-1.5 text-[11px] text-zinc-800 dark:text-zinc-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {displayLines.join('\n')}
                        </pre>
                        {lines.length > 5 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailsExpanded(!detailsExpanded);
                                }}
                                className="w-full py-0.5 text-[10px] text-blue-600 dark:text-blue-400 bg-zinc-200 dark:bg-zinc-800 border-t border-zinc-300 dark:border-zinc-700"
                            >
                                {detailsExpanded ? 'less' : `+${lines.length - 5} more...`}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    function renderSearch(data: Extract<ToolDisplayData, { type: 'search' }>) {
        const matches = data.matches.slice(0, detailsExpanded ? 15 : 5);

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                    <Search className="h-3 w-3 text-muted-foreground" />
                    <code className="font-mono text-foreground/70">{data.pattern}</code>
                    <span className="text-muted-foreground">
                        {data.totalMatches} matches{data.truncated && '+'}
                    </span>
                </div>
                <div className="bg-muted/30 rounded overflow-hidden border border-border/50 divide-y divide-border/30">
                    {matches.map((m, i) => (
                        <div key={i} className="px-2 py-1 text-[11px]">
                            <span className="text-blue-600 dark:text-blue-400 font-mono">
                                {getShortPath(m.file)}
                            </span>
                            {m.line > 0 && <span className="text-muted-foreground">:{m.line}</span>}
                            {m.content && (
                                <div className="text-foreground/60 font-mono truncate">
                                    {m.content}
                                </div>
                            )}
                        </div>
                    ))}
                    {data.matches.length > 5 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setDetailsExpanded(!detailsExpanded);
                            }}
                            className="w-full py-0.5 text-[10px] text-blue-500 bg-muted/50"
                        >
                            {detailsExpanded ? 'less' : `+${data.matches.length - 5} more...`}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    function renderFile(data: Extract<ToolDisplayData, { type: 'file' }>) {
        const OpIcon = { read: FileText, write: FileEdit, create: FilePlus, delete: Trash2 }[
            data.operation
        ];
        const opColors = {
            read: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600',
            write: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600',
            create: 'bg-green-100 dark:bg-green-900/30 text-green-600',
            delete: 'bg-red-100 dark:bg-red-900/30 text-red-600',
        }[data.operation];

        return (
            <div className="flex items-center gap-2 text-[11px]">
                <OpIcon className="h-3 w-3 text-muted-foreground" />
                <span className={cn('px-1 py-0.5 rounded text-[10px]', opColors)}>
                    {data.operation}
                </span>
                <span className="font-mono text-foreground/70">{getShortPath(data.path)}</span>
                {data.lineCount !== undefined && (
                    <span className="text-muted-foreground">{data.lineCount} lines</span>
                )}
            </div>
        );
    }

    // =========================================================================
    // Render functions for generating preview from toolArgs (no displayData)
    // =========================================================================

    function renderBashResult(_command: string) {
        // Extract and parse bash result from tool result
        let stdout = '';
        let stderr = '';
        let exitCode: number | undefined;
        let duration: number | undefined;

        if (toolResult && typeof toolResult === 'object') {
            const result = toolResult as Record<string, unknown>;
            if (result.content && Array.isArray(result.content)) {
                const textContent = result.content
                    .filter(
                        (p: unknown) =>
                            typeof p === 'object' &&
                            p !== null &&
                            (p as Record<string, unknown>).type === 'text'
                    )
                    .map((p: unknown) => (p as { text?: string }).text || '')
                    .join('\n');

                // Try to parse as JSON bash result
                try {
                    const parsed = JSON.parse(textContent);
                    if (typeof parsed === 'object' && parsed !== null) {
                        stdout = parsed.stdout || '';
                        stderr = parsed.stderr || '';
                        exitCode =
                            typeof parsed.exit_code === 'number' ? parsed.exit_code : undefined;
                        duration =
                            typeof parsed.duration === 'number' ? parsed.duration : undefined;
                    }
                } catch {
                    // Not JSON, treat as plain output
                    stdout = textContent;
                }
            }
        }

        const output = stdout || stderr;
        if (!output && exitCode === undefined) return null;

        const lines = output.split('\n').filter((l) => l.trim());
        const displayLines = lines.slice(0, detailsExpanded ? 25 : 5);
        const isError = exitCode !== undefined && exitCode !== 0;

        return (
            <div className="ml-5 space-y-1">
                {/* Status bar */}
                <div className="flex items-center gap-2 text-[10px]">
                    {exitCode !== undefined && (
                        <span
                            className={cn(
                                'px-1.5 py-0.5 rounded font-medium',
                                isError
                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                                    : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                            )}
                        >
                            {isError ? `exit ${exitCode}` : 'success'}
                        </span>
                    )}
                    {duration !== undefined && (
                        <span className="text-muted-foreground">{duration}ms</span>
                    )}
                </div>

                {/* Output */}
                {output && (
                    <div className="bg-zinc-100 dark:bg-zinc-900 rounded overflow-hidden border border-zinc-200 dark:border-zinc-800">
                        <pre className="p-1.5 text-[11px] text-zinc-800 dark:text-zinc-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {displayLines.join('\n')}
                        </pre>
                        {lines.length > 5 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailsExpanded(!detailsExpanded);
                                }}
                                className="w-full py-0.5 text-[10px] text-blue-600 dark:text-blue-400 bg-zinc-200 dark:bg-zinc-800 border-t border-zinc-300 dark:border-zinc-700"
                            >
                                {detailsExpanded ? 'less' : `+${lines.length - 5} more...`}
                            </button>
                        )}
                    </div>
                )}

                {/* Stderr if present and different from stdout */}
                {stderr && stderr !== stdout && (
                    <div className="bg-red-50 dark:bg-red-950/30 rounded overflow-hidden border border-red-200 dark:border-red-900/30">
                        <div className="px-2 py-0.5 text-[10px] text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/30">
                            stderr
                        </div>
                        <pre className="p-1.5 text-[11px] text-red-800 dark:text-red-300 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
                            {stderr}
                        </pre>
                    </div>
                )}
            </div>
        );
    }

    function renderEditResult(_filePath: string, oldString: string, newString: string) {
        return (
            <div className="ml-5 bg-muted/30 rounded overflow-hidden border border-border/50 text-[11px] font-mono">
                {oldString
                    .split('\n')
                    .slice(0, detailsExpanded ? 15 : 3)
                    .map((line, i) => (
                        <div
                            key={`o${i}`}
                            className="px-2 py-0.5 bg-red-100/50 dark:bg-red-900/20 text-red-800 dark:text-red-300"
                        >
                            <span className="text-red-500/50 mr-1">-</span>
                            {line || ' '}
                        </div>
                    ))}
                {newString
                    .split('\n')
                    .slice(0, detailsExpanded ? 15 : 3)
                    .map((line, i) => (
                        <div
                            key={`n${i}`}
                            className="px-2 py-0.5 bg-green-100/50 dark:bg-green-900/20 text-green-800 dark:text-green-300"
                        >
                            <span className="text-green-500/50 mr-1">+</span>
                            {line || ' '}
                        </div>
                    ))}
                {(oldString.split('\n').length > 3 || newString.split('\n').length > 3) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setDetailsExpanded(!detailsExpanded);
                        }}
                        className="w-full py-0.5 text-[10px] text-blue-500 bg-muted/50 border-t border-border/30"
                    >
                        {detailsExpanded ? 'less' : 'more...'}
                    </button>
                )}
            </div>
        );
    }

    function renderWriteResult(filePath: string, content: string) {
        return (
            <div className="ml-5">
                <CodePreview
                    content={content}
                    filePath={filePath}
                    maxLines={8}
                    maxHeight={180}
                    showHeader={false}
                />
            </div>
        );
    }

    function renderReadResult(filePath: string) {
        // Extract content from tool result
        let content = '';
        if (toolResult && typeof toolResult === 'object') {
            const result = toolResult as Record<string, unknown>;
            if (result.content && Array.isArray(result.content)) {
                content = result.content
                    .filter(
                        (p: unknown) =>
                            typeof p === 'object' &&
                            p !== null &&
                            (p as Record<string, unknown>).type === 'text'
                    )
                    .map((p: unknown) => (p as { text?: string }).text || '')
                    .join('\n');
            }
        }

        if (!content) return null;

        return (
            <div className="ml-5">
                <CodePreview
                    content={content}
                    filePath={filePath}
                    maxLines={8}
                    maxHeight={180}
                    showHeader={false}
                />
            </div>
        );
    }

    function renderGenericResult() {
        // Extract text from result
        let resultText = '';
        if (toolResult && typeof toolResult === 'object') {
            const result = toolResult as Record<string, unknown>;
            if (result.content && Array.isArray(result.content)) {
                resultText = result.content
                    .filter(
                        (p: unknown) =>
                            typeof p === 'object' &&
                            p !== null &&
                            (p as Record<string, unknown>).type === 'text'
                    )
                    .map((p: unknown) => (p as { text?: string }).text || '')
                    .join('\n');
            }
        }

        if (!resultText) return null;

        const lines = resultText.split('\n');
        const displayLines = lines.slice(0, detailsExpanded ? 20 : 5);

        return (
            <div className="bg-muted/30 rounded overflow-hidden border border-border/50">
                <pre className="p-1.5 text-[11px] text-foreground/70 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {displayLines.join('\n')}
                </pre>
                {lines.length > 5 && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setDetailsExpanded(!detailsExpanded);
                        }}
                        className="w-full py-0.5 text-[10px] text-blue-500 bg-muted/50 border-t border-border/30"
                    >
                        {detailsExpanded ? 'less' : `+${lines.length - 5} more...`}
                    </button>
                )}
            </div>
        );
    }
}
