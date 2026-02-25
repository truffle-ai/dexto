/**
 * Tool Result Renderers
 *
 * Dispatch component that renders tool results based on display type.
 * Uses discriminated union from ToolDisplayData for type-safe rendering.
 */

import React from 'react';
import type { ContentPart, ToolDisplayData } from '@dexto/core';
import { DiffRenderer } from './DiffRenderer.js';
import { ShellRenderer } from './ShellRenderer.js';
import { SearchRenderer } from './SearchRenderer.js';
import { FileRenderer } from './FileRenderer.js';
import { GenericRenderer } from './GenericRenderer.js';

// Re-export individual renderers for direct use
export { DiffRenderer } from './DiffRenderer.js';
export { ShellRenderer } from './ShellRenderer.js';
export { SearchRenderer } from './SearchRenderer.js';
export { FileRenderer } from './FileRenderer.js';
export { GenericRenderer } from './GenericRenderer.js';

// File preview renderers for approval prompts (full content, no truncation)
export { DiffPreview, CreateFilePreview } from './FilePreviewRenderer.js';

interface ToolResultRendererProps {
    /** Display data from SanitizedToolResult.meta.display */
    display?: ToolDisplayData;
    /** Content parts from SanitizedToolResult.content */
    content: ContentPart[];
    /** Maximum lines/matches to display */
    maxLines?: number;
}

/**
 * Renders tool results based on display type.
 * Falls back to GenericRenderer for unknown types or missing display data.
 * Each renderer uses its own default limits - only pass maxLines to override.
 */
export function ToolResultRenderer({ display, content, maxLines }: ToolResultRendererProps) {
    // Default to generic if no display data
    const displayData = display ?? { type: 'generic' as const };

    switch (displayData.type) {
        case 'diff':
            return (
                <DiffRenderer data={displayData} {...(maxLines !== undefined && { maxLines })} />
            );

        case 'shell':
            return (
                <ShellRenderer data={displayData} {...(maxLines !== undefined && { maxLines })} />
            );

        case 'search':
            return (
                <SearchRenderer
                    data={displayData}
                    {...(maxLines !== undefined && { maxMatches: maxLines })}
                />
            );

        case 'file':
            return (
                <FileRenderer data={displayData} {...(maxLines !== undefined && { maxLines })} />
            );

        case 'generic':
        default:
            return (
                <GenericRenderer content={content} {...(maxLines !== undefined && { maxLines })} />
            );
    }
}
