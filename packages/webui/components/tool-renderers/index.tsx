/**
 * Tool Result Renderers
 *
 * Dispatch component that renders tool results based on display type.
 * Uses discriminated union from ToolDisplayData for type-safe rendering.
 */

import { AlertCircle } from 'lucide-react';
import type { ToolDisplayData } from '@dexto/core';
import { DiffRenderer } from './DiffRenderer';
import { ShellRenderer } from './ShellRenderer';
import { SearchRenderer } from './SearchRenderer';
import { FileRenderer } from './FileRenderer';
import { GenericRenderer } from './GenericRenderer';

// Re-export individual renderers for direct use
export { DiffRenderer } from './DiffRenderer';
export { ShellRenderer } from './ShellRenderer';
export { SearchRenderer } from './SearchRenderer';
export { FileRenderer } from './FileRenderer';
export { GenericRenderer } from './GenericRenderer';

interface ToolResultRendererProps {
    /** Display data from SanitizedToolResult.meta.display */
    display?: ToolDisplayData;
    /** Raw content for fallback rendering */
    content?: unknown;
    /** Whether the tool execution was successful */
    success?: boolean;
    /** Override default expansion behavior */
    defaultExpanded?: boolean;
}

/**
 * Determine if the result should be expanded by default.
 * Smart default: expand errors, collapse successes.
 */
function shouldExpandByDefault(success: boolean | undefined): boolean {
    // Expand if there was an error
    if (success === false) return true;
    // Otherwise collapse
    return false;
}

/**
 * Check if the content is an error result (old format with {error: ...}).
 */
function isLegacyErrorResult(
    content: unknown
): content is { error: string | Record<string, unknown> } {
    return typeof content === 'object' && content !== null && 'error' in content;
}

/**
 * Check if the content is a SanitizedToolResult with content array.
 */
function isSanitizedResult(
    content: unknown
): content is { content: Array<{ type: string; text?: string }> } {
    return (
        typeof content === 'object' &&
        content !== null &&
        'content' in content &&
        Array.isArray((content as { content: unknown }).content)
    );
}

/**
 * Extract error text from content (handles both formats).
 */
function extractErrorText(content: unknown): string {
    // Legacy format: { error: "message" }
    if (isLegacyErrorResult(content)) {
        const error = content.error;
        return typeof error === 'string' ? error : JSON.stringify(error, null, 2);
    }

    // SanitizedToolResult format: { content: [{ type: 'text', text: '...' }] }
    if (isSanitizedResult(content)) {
        const textParts = content.content
            .filter((part) => part.type === 'text' && part.text)
            .map((part) => part.text || '')
            .join('\n');
        return textParts || 'Unknown error';
    }

    // Plain string
    if (typeof content === 'string') {
        return content;
    }

    // Fallback
    return JSON.stringify(content, null, 2);
}

/**
 * Error display component for failed tool executions.
 */
function ErrorRenderer({ errorText }: { errorText: string }) {
    return (
        <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-2">
            <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">
                        Tool execution failed
                    </p>
                    <pre className="text-[11px] font-mono text-red-700 dark:text-red-400 whitespace-pre-wrap break-all max-h-48 overflow-y-auto scrollbar-thin">
                        {errorText}
                    </pre>
                </div>
            </div>
        </div>
    );
}

/**
 * Renders tool results based on display type.
 * Falls back to GenericRenderer for unknown types or missing display data.
 * Shows error renderer for failed tool executions.
 */
export function ToolResultRenderer({
    display,
    content,
    success,
    defaultExpanded,
}: ToolResultRendererProps) {
    // Calculate expansion state
    const shouldExpand = defaultExpanded ?? shouldExpandByDefault(success);

    // If this is an error result, show the error renderer
    if (success === false) {
        const errorText = extractErrorText(content);
        return <ErrorRenderer errorText={errorText} />;
    }

    // No display data - use generic renderer
    if (!display) {
        return <GenericRenderer content={content} defaultExpanded={shouldExpand} />;
    }

    switch (display.type) {
        case 'diff':
            return <DiffRenderer data={display} defaultExpanded={shouldExpand} />;

        case 'shell':
            return <ShellRenderer data={display} defaultExpanded={shouldExpand} />;

        case 'search':
            return <SearchRenderer data={display} defaultExpanded={shouldExpand} />;

        case 'file':
            // File renderer is always visible (no collapse)
            return <FileRenderer data={display} />;

        case 'generic':
        default:
            return <GenericRenderer content={content} defaultExpanded={shouldExpand} />;
    }
}
