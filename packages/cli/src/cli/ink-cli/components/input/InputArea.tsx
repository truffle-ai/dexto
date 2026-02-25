/**
 * InputArea Component
 * Wrapper around TextBufferInput - accepts buffer from parent
 */

import React from 'react';
import { Box } from 'ink';
import { TextBufferInput, type OverlayTrigger } from '../TextBufferInput.js';
import type { TextBuffer } from '../shared/text-buffer.js';
import type { PendingImage, PastedBlock } from '../../state/types.js';

export type { OverlayTrigger };

interface InputAreaProps {
    /** Text buffer (owned by parent) */
    buffer: TextBuffer;
    /** Called when user submits */
    onSubmit: (value: string) => void;
    /** Whether input is currently disabled */
    isDisabled: boolean;
    /** Whether input should handle keypresses */
    isActive: boolean;
    /** Placeholder text */
    placeholder?: string | undefined;
    /** History navigation callback */
    onHistoryNavigate?: ((direction: 'up' | 'down') => void) | undefined;
    /** Overlay trigger callback */
    onTriggerOverlay?: ((trigger: OverlayTrigger) => void) | undefined;
    /** Keyboard scroll callback (for alternate buffer mode) */
    onKeyboardScroll?: ((direction: 'up' | 'down') => void) | undefined;
    /** Current number of attached images (for placeholder numbering) */
    imageCount?: number | undefined;
    /** Called when image is pasted from clipboard */
    onImagePaste?: ((image: PendingImage) => void) | undefined;
    /** Current pending images (for placeholder removal detection) */
    images?: PendingImage[] | undefined;
    /** Called when an image placeholder is removed from text */
    onImageRemove?: ((imageId: string) => void) | undefined;
    /** Current pasted blocks for collapse/expand feature */
    pastedBlocks?: PastedBlock[] | undefined;
    /** Called when a large paste is detected and should be collapsed */
    onPasteBlock?: ((block: PastedBlock) => void) | undefined;
    /** Called to update a pasted block (e.g., toggle collapse) */
    onPasteBlockUpdate?: ((blockId: string, updates: Partial<PastedBlock>) => void) | undefined;
    /** Called when a paste block placeholder is removed from text */
    onPasteBlockRemove?: ((blockId: string) => void) | undefined;
    /** Query to highlight in input text (for history search) */
    highlightQuery?: string | undefined;
    /** Cycle reasoning variant (only when the main input is active). */
    onCycleReasoningVariant?: (() => void) | undefined;
}

export function InputArea({
    buffer,
    onSubmit,
    isDisabled,
    isActive,
    placeholder,
    onHistoryNavigate,
    onTriggerOverlay,
    onKeyboardScroll,
    imageCount,
    onImagePaste,
    images,
    onImageRemove,
    pastedBlocks,
    onPasteBlock,
    onPasteBlockUpdate,
    onPasteBlockRemove,
    highlightQuery,
    onCycleReasoningVariant,
}: InputAreaProps) {
    return (
        <Box flexDirection="column">
            <TextBufferInput
                buffer={buffer}
                onSubmit={onSubmit}
                placeholder={placeholder}
                isDisabled={isDisabled}
                isActive={isActive}
                onHistoryNavigate={onHistoryNavigate}
                onTriggerOverlay={onTriggerOverlay}
                onKeyboardScroll={onKeyboardScroll}
                imageCount={imageCount}
                onImagePaste={onImagePaste}
                images={images}
                onImageRemove={onImageRemove}
                pastedBlocks={pastedBlocks}
                onPasteBlock={onPasteBlock}
                onPasteBlockUpdate={onPasteBlockUpdate}
                onPasteBlockRemove={onPasteBlockRemove}
                highlightQuery={highlightQuery}
                onCycleReasoningVariant={onCycleReasoningVariant}
            />
        </Box>
    );
}
