/**
 * ShellRenderer Component
 *
 * Renders shell command execution results with exit code badge,
 * duration, and stdout/stderr output.
 */

import { useState } from 'react';
import { Terminal, ChevronDown, ChevronRight, Copy, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShellDisplayData } from '@dexto/core';

interface ShellRendererProps {
    /** Shell display data from tool result */
    data: ShellDisplayData;
    /** Maximum lines before truncation (default: 10) */
    maxLines?: number;
    /** Whether to start expanded (default: based on exit code) */
    defaultExpanded?: boolean;
}

/**
 * Format duration in human-readable format.
 */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * Renders shell command result with collapsible output.
 */
export function ShellRenderer({ data, maxLines = 10, defaultExpanded }: ShellRendererProps) {
    const { command, exitCode, duration, stdout, stderr, isBackground } = data;

    // Expand by default if there was an error
    const [expanded, setExpanded] = useState(defaultExpanded ?? exitCode !== 0);
    const [showAll, setShowAll] = useState(false);
    const [copied, setCopied] = useState(false);

    const output = stdout || stderr || '';
    const lines = output.split('\n').filter((line) => line.length > 0);
    const shouldTruncate = lines.length > maxLines && !showAll;
    const displayLines = shouldTruncate ? lines.slice(0, maxLines) : lines;

    const isSuccess = exitCode === 0;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(output);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard API failed - non-secure context or permission denied
            console.warn('Failed to copy to clipboard');
        }
    };

    return (
        <div className="space-y-1.5">
            {/* Header with command and metadata */}
            <div className="flex items-center gap-2 flex-wrap">
                {/* Command (truncated) */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <code className="text-xs font-mono text-foreground/80 truncate" title={command}>
                        {command.length > 60 ? `${command.substring(0, 60)}...` : command}
                    </code>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1.5">
                    {/* Exit code badge */}
                    <span
                        className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-medium',
                            isSuccess
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        )}
                    >
                        {isSuccess ? 'exit 0' : `exit ${exitCode}`}
                    </span>

                    {/* Duration */}
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDuration(duration)}
                    </span>

                    {/* Background indicator */}
                    {isBackground && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            bg
                        </span>
                    )}
                </div>
            </div>

            {/* Output section */}
            {lines.length > 0 && (
                <div className="pl-5">
                    {!expanded ? (
                        <button
                            onClick={() => setExpanded(true)}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ChevronRight className="h-3 w-3" />
                            <span>
                                {lines.length} line{lines.length !== 1 ? 's' : ''} of output
                            </span>
                        </button>
                    ) : (
                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <button
                                    onClick={() => setExpanded(false)}
                                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <ChevronDown className="h-3 w-3" />
                                    <span>Output</span>
                                </button>
                                <button
                                    onClick={handleCopy}
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-3 w-3 text-green-500" />
                                            <span>Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3 w-3" />
                                            <span>Copy</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <div
                                className={cn(
                                    'bg-muted/30 rounded-md p-2 overflow-x-auto',
                                    !isSuccess && 'border-l-2 border-red-500'
                                )}
                            >
                                <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all max-h-48 overflow-y-auto scrollbar-thin">
                                    {displayLines.join('\n')}
                                </pre>
                                {shouldTruncate && (
                                    <button
                                        onClick={() => setShowAll(true)}
                                        className="mt-2 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                                    >
                                        Show {lines.length - maxLines} more lines...
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* No output indicator */}
            {lines.length === 0 && (
                <div className="pl-5 text-xs text-muted-foreground italic">(no output)</div>
            )}
        </div>
    );
}
