/**
 * Tool Result Renderers
 *
 * Main dispatcher component that routes to the appropriate renderer
 * based on tool display data type.
 */

import type { ToolDisplayData } from '@dexto/core';
import { DiffRenderer } from './DiffRenderer';
import { ShellRenderer } from './ShellRenderer';
import { SearchRenderer } from './SearchRenderer';
import { FileRenderer } from './FileRenderer';
import { GenericRenderer } from './GenericRenderer';

export interface ToolResultRendererProps {
    /** Display data from tool result (contains type discriminator) */
    displayData?: ToolDisplayData;
    /** Raw tool result for fallback rendering */
    toolResult?: unknown;
    /** Whether the tool call succeeded */
    success?: boolean;
    /** Default expanded state */
    defaultExpanded?: boolean;
}

/**
 * Main dispatcher component for tool result rendering.
 * Routes to specialized renderers based on displayData.type
 */
export function ToolResultRenderer({
    displayData,
    toolResult,
    success = true,
    defaultExpanded = false,
}: ToolResultRendererProps) {
    // Smart default: expand errors, collapse successes
    const shouldExpand = defaultExpanded || !success;

    // If we have display data, use the appropriate renderer
    if (displayData) {
        switch (displayData.type) {
            case 'diff':
                return <DiffRenderer data={displayData} defaultExpanded={shouldExpand} />;
            case 'shell':
                return <ShellRenderer data={displayData} defaultExpanded={shouldExpand} />;
            case 'search':
                return <SearchRenderer data={displayData} defaultExpanded={shouldExpand} />;
            case 'file':
                return <FileRenderer data={displayData} />;
            case 'generic':
                return (
                    <GenericRenderer data={displayData.content} defaultExpanded={shouldExpand} />
                );
        }
    }

    // Fallback to generic renderer with raw result
    if (toolResult !== undefined) {
        return <GenericRenderer data={toolResult} defaultExpanded={shouldExpand} />;
    }

    return null;
}

// Re-export individual renderers for direct use if needed
export { DiffRenderer } from './DiffRenderer';
export { ShellRenderer } from './ShellRenderer';
export { SearchRenderer } from './SearchRenderer';
export { FileRenderer } from './FileRenderer';
export { GenericRenderer } from './GenericRenderer';
