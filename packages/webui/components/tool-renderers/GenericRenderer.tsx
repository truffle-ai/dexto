/**
 * GenericRenderer Component
 *
 * Fallback renderer for unknown tool types or when no display data is available.
 * Displays raw JSON/text content with syntax highlighting.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';

// Register JSON language
hljs.registerLanguage('json', json);

interface GenericRendererProps {
    /** Raw content to display */
    content: unknown;
    /** Maximum lines before truncation (default: 20) */
    maxLines?: number;
    /** Whether to start expanded (default: false) */
    defaultExpanded?: boolean;
}

/**
 * Escape HTML entities to prevent XSS when using dangerouslySetInnerHTML
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Renders generic tool result content with syntax highlighting.
 */
export function GenericRenderer({
    content,
    maxLines = 20,
    defaultExpanded = false,
}: GenericRendererProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [showAll, setShowAll] = useState(false);
    const [copied, setCopied] = useState(false);

    // Format content as string
    const formattedContent =
        typeof content === 'string' ? content : JSON.stringify(content, null, 2);

    const lines = formattedContent.split('\n');
    const shouldTruncate = lines.length > maxLines && !showAll;
    const displayContent = shouldTruncate ? lines.slice(0, maxLines).join('\n') : formattedContent;

    // Syntax highlight if it looks like JSON, otherwise escape HTML for safety
    let highlightedContent: string;
    try {
        if (typeof content === 'object' || formattedContent.startsWith('{')) {
            const result = hljs.highlight(displayContent, { language: 'json' });
            highlightedContent = result.value;
        } else {
            // Not JSON - escape HTML entities for plain text
            highlightedContent = escapeHtml(displayContent);
        }
    } catch {
        // Highlight failed - escape HTML entities for safety
        highlightedContent = escapeHtml(displayContent);
    }

    const handleCopy = async () => {
        await navigator.clipboard.writeText(formattedContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!expanded) {
        return (
            <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <ChevronRight className="h-3 w-3" />
                <span className="font-mono">
                    {lines.length} line{lines.length !== 1 ? 's' : ''} of output
                </span>
            </button>
        );
    }

    return (
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
            <div className="bg-muted/30 rounded-md p-2 overflow-x-auto">
                <pre
                    className={cn(
                        'text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all',
                        'max-h-64 overflow-y-auto scrollbar-thin'
                    )}
                    dangerouslySetInnerHTML={{ __html: highlightedContent }}
                />
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
    );
}
