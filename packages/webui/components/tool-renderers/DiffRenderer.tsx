/**
 * DiffRenderer Component
 *
 * Renders unified diff with syntax highlighting.
 * Shows filename, +N/-M stats, and colored diff lines.
 */

import { useState } from 'react';
import { FileEdit, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DiffDisplayData } from '@dexto/core';

interface DiffRendererProps {
    /** Diff display data from tool result */
    data: DiffDisplayData;
    /** Maximum lines before truncation (default: 50) */
    maxLines?: number;
    /** Whether to start expanded (default: false) */
    defaultExpanded?: boolean;
}

// =============================================================================
// Diff Parsing (ported from CLI)
// =============================================================================

interface ParsedHunk {
    oldStart: number;
    newStart: number;
    lines: ParsedLine[];
}

interface ParsedLine {
    type: 'context' | 'addition' | 'deletion';
    content: string;
    lineNum: number;
}

/**
 * Parse unified diff into structured hunks.
 */
function parseUnifiedDiff(unified: string): ParsedHunk[] {
    const lines = unified.split('\n');
    const hunks: ParsedHunk[] = [];
    let currentHunk: ParsedHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
        if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
            continue;
        }

        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
            if (currentHunk) {
                hunks.push(currentHunk);
            }
            oldLine = parseInt(hunkMatch[1]!, 10);
            newLine = parseInt(hunkMatch[3]!, 10);
            currentHunk = {
                oldStart: oldLine,
                newStart: newLine,
                lines: [],
            };
            continue;
        }

        if (!currentHunk) continue;

        if (line.startsWith('+')) {
            currentHunk.lines.push({
                type: 'addition',
                content: line.slice(1),
                lineNum: newLine++,
            });
        } else if (line.startsWith('-')) {
            currentHunk.lines.push({
                type: 'deletion',
                content: line.slice(1),
                lineNum: oldLine++,
            });
        } else if (line.startsWith(' ') || line === '') {
            currentHunk.lines.push({
                type: 'context',
                content: line.startsWith(' ') ? line.slice(1) : line,
                lineNum: newLine,
            });
            oldLine++;
            newLine++;
        }
    }

    if (currentHunk) {
        hunks.push(currentHunk);
    }

    return hunks;
}

/**
 * Get line number width for consistent alignment.
 */
function getLineNumWidth(maxLineNum: number): number {
    return Math.max(3, String(maxLineNum).length);
}

/**
 * Format line number with padding.
 */
function formatLineNum(num: number, width: number): string {
    return String(num).padStart(width, ' ');
}

// =============================================================================
// Line Components
// =============================================================================

interface DiffLineProps {
    type: 'context' | 'addition' | 'deletion';
    lineNum: number;
    lineNumWidth: number;
    content: string;
}

/**
 * Render a single diff line with gutter and content.
 */
function DiffLine({ type, lineNum, lineNumWidth, content }: DiffLineProps) {
    const lineNumStr = formatLineNum(lineNum, lineNumWidth);

    const getStyles = () => {
        switch (type) {
            case 'deletion':
                return {
                    bg: 'bg-red-100/50 dark:bg-red-900/20',
                    text: 'text-red-800 dark:text-red-300',
                    symbol: '-',
                    symbolColor: 'text-red-600 dark:text-red-400',
                };
            case 'addition':
                return {
                    bg: 'bg-green-100/50 dark:bg-green-900/20',
                    text: 'text-green-800 dark:text-green-300',
                    symbol: '+',
                    symbolColor: 'text-green-600 dark:text-green-400',
                };
            default:
                return {
                    bg: '',
                    text: 'text-foreground/60',
                    symbol: ' ',
                    symbolColor: 'text-transparent',
                };
        }
    };

    const styles = getStyles();

    return (
        <div className={cn('flex font-mono text-[11px] leading-5', styles.bg)}>
            {/* Gutter: line number + symbol */}
            <div className="flex-shrink-0 select-none">
                <span className="text-muted-foreground/50 px-1">{lineNumStr}</span>
                <span className={cn('px-0.5', styles.symbolColor)}>{styles.symbol}</span>
            </div>
            {/* Content */}
            <pre className={cn('flex-1 px-1 whitespace-pre-wrap break-all', styles.text)}>
                {content || ' '}
            </pre>
        </div>
    );
}

/**
 * Hunk separator.
 */
function HunkSeparator() {
    return (
        <div className="text-muted-foreground text-[10px] py-0.5 px-2 bg-muted/20">
            <span className="text-muted-foreground/60">···</span>
        </div>
    );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Extract relative path from full path.
 */
function getRelativePath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-3).join('/')}`;
}

/**
 * Renders unified diff with syntax highlighting and line numbers.
 */
export function DiffRenderer({ data, maxLines = 50, defaultExpanded = false }: DiffRendererProps) {
    const { unified, filename, additions, deletions } = data;
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [showAll, setShowAll] = useState(false);
    const [copied, setCopied] = useState(false);

    const hunks = parseUnifiedDiff(unified);

    // Calculate max line number for width
    let maxLineNum = 1;
    let totalLines = 0;
    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            maxLineNum = Math.max(maxLineNum, line.lineNum);
            totalLines++;
        }
    }
    const lineNumWidth = getLineNumWidth(maxLineNum);

    const shouldTruncate = totalLines > maxLines && !showAll;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(unified);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-1.5">
            {/* Header with filename and stats */}
            <div className="flex items-center gap-2 flex-wrap">
                <FileEdit className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="font-mono text-xs text-foreground/80 truncate" title={filename}>
                    {getRelativePath(filename)}
                </span>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
                        +{additions}
                    </span>
                    <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
                        -{deletions}
                    </span>
                </div>
            </div>

            {/* Diff content */}
            <div className="pl-5">
                {!expanded ? (
                    <button
                        onClick={() => setExpanded(true)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ChevronRight className="h-3 w-3" />
                        <span>
                            Show diff ({totalLines} line{totalLines !== 1 ? 's' : ''})
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
                                <span>Diff</span>
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
                        <div className="bg-muted/30 rounded-md overflow-hidden border border-border/50">
                            <div className="max-h-96 overflow-y-auto scrollbar-thin">
                                {(() => {
                                    let linesRendered = 0;
                                    return hunks.map((hunk, hunkIndex) => {
                                        if (shouldTruncate && linesRendered >= maxLines) {
                                            return null;
                                        }

                                        return (
                                            <div key={hunkIndex}>
                                                {hunkIndex > 0 && <HunkSeparator />}
                                                {hunk.lines.map((line, lineIndex) => {
                                                    if (
                                                        shouldTruncate &&
                                                        linesRendered >= maxLines
                                                    ) {
                                                        return null;
                                                    }
                                                    linesRendered++;
                                                    return (
                                                        <DiffLine
                                                            key={`${hunkIndex}-${lineIndex}`}
                                                            type={line.type}
                                                            lineNum={line.lineNum}
                                                            lineNumWidth={lineNumWidth}
                                                            content={line.content}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                            {shouldTruncate && (
                                <button
                                    onClick={() => setShowAll(true)}
                                    className="w-full py-2 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 bg-muted/50 border-t border-border/50"
                                >
                                    Show {totalLines - maxLines} more lines...
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
