/**
 * InputArea Component
 * Wrapper around TextBufferInput - accepts buffer from parent
 */

import React from 'react';
import { Box } from 'ink';
import { TextBufferInput, type OverlayTrigger } from '../TextBufferInput.js';
import type { TextBuffer } from '../shared/text-buffer.js';

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
            />
        </Box>
    );
}
