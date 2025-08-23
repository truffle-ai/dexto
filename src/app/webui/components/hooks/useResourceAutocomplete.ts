'use client';
import React, { useState, useRef, useCallback } from 'react';
import { ResourceMetadata } from './useResources';

// Add DOM types for browser environment
declare global {
    interface Window {
        HTMLTextAreaElement: typeof HTMLTextAreaElement;
        Event: typeof Event;
    }
}

interface AutocompleteState {
    isOpen: boolean;
    query: string;
    position: { top: number; left: number };
    selectedIndex: number;
    triggerPosition: number; // Position of @ in text
}

export function useResourceAutocomplete(textareaRef: React.RefObject<HTMLTextAreaElement | null>) {
    const [state, setState] = useState<AutocompleteState>({
        isOpen: false,
        query: '',
        position: { top: 0, left: 0 },
        selectedIndex: 0,
        triggerPosition: -1,
    });

    const filteredResourcesRef = useRef<ResourceMetadata[]>([]);

    // Calculate position for dropdown placement above the textarea
    const calculateDropdownPosition = useCallback(
        (textarea: HTMLTextAreaElement, _cursorPosition: number): { top: number; left: number } => {
            // Find the input area container (the main wrapper)
            const inputAreaContainer = textarea.closest('#input-area');
            if (!inputAreaContainer) {
                // Fallback to textarea's parent if input area not found
                const textareaRect = textarea.getBoundingClientRect();
                const parentElement = textarea.closest('.relative');
                const parentRect = parentElement
                    ? parentElement.getBoundingClientRect()
                    : textareaRect;

                const styles = window.getComputedStyle(textarea);
                const paddingLeft = parseInt(styles.paddingLeft, 10) || 0;
                const dropdownHeight = 200;
                const textareaRelativeTop = textareaRect.top - parentRect.top;

                return {
                    top: textareaRelativeTop - dropdownHeight - 8,
                    left: textareaRect.left - parentRect.left + paddingLeft,
                };
            }

            // Get the input area container's position
            const inputAreaRect = inputAreaContainer.getBoundingClientRect();
            const textareaRect = textarea.getBoundingClientRect();

            // Get textarea's computed styles to account for padding
            const styles = window.getComputedStyle(textarea);
            const paddingLeft = parseInt(styles.paddingLeft, 10) || 0;

            // Calculate position relative to the input area container
            const dropdownHeight = 200;
            const textareaRelativeTop = textareaRect.top - inputAreaRect.top;
            const textareaRelativeLeft = textareaRect.left - inputAreaRect.left;

            // Position above the textarea with padding, aligned with the input area
            const top = textareaRelativeTop - dropdownHeight - 8;
            // Align with left edge of textarea content (accounting for padding)
            const left = textareaRelativeLeft + paddingLeft;

            return { top, left };
        },
        []
    );

    // Detect @ trigger and update autocomplete state
    const handleTextChange = useCallback(
        (text: string, cursorPosition: number) => {
            if (!textareaRef.current) return;

            // Find the last @ before cursor position
            const textBeforeCursor = text.substring(0, cursorPosition);
            const lastAtIndex = textBeforeCursor.lastIndexOf('@');

            if (lastAtIndex === -1) {
                // No @ found, close autocomplete
                setState((prev) => ({ ...prev, isOpen: false }));
                return;
            }

            // Check if there's a space between @ and cursor (which would end the reference)
            const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
            if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
                setState((prev) => ({ ...prev, isOpen: false }));
                return;
            }

            // Check if @ is at word boundary (not part of email address)
            const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : '';
            if (charBeforeAt && /[a-zA-Z0-9]/.test(charBeforeAt)) {
                setState((prev) => ({ ...prev, isOpen: false }));
                return;
            }

            // Valid @ trigger found - show autocomplete
            const query = '@' + textAfterAt;
            const position = calculateDropdownPosition(textareaRef.current, cursorPosition);

            setState((_prev) => ({
                isOpen: true,
                query,
                position,
                selectedIndex: 0, // Always reset to 0 when query changes
                triggerPosition: lastAtIndex,
            }));
        },
        [textareaRef, calculateDropdownPosition]
    );

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent, filteredResources: ResourceMetadata[]): boolean => {
            if (!state.isOpen || filteredResources.length === 0) return false;

            filteredResourcesRef.current = filteredResources;

            switch (event.key) {
                case 'ArrowDown':
                    event.preventDefault();
                    setState((prev) => ({
                        ...prev,
                        selectedIndex: Math.min(
                            prev.selectedIndex + 1,
                            filteredResources.length - 1
                        ),
                    }));
                    return true;

                case 'ArrowUp':
                    event.preventDefault();
                    setState((prev) => ({
                        ...prev,
                        selectedIndex: Math.max(prev.selectedIndex - 1, 0),
                    }));
                    return true;

                case 'Enter':
                case 'Tab': {
                    event.preventDefault();
                    const selectedResource = filteredResources[state.selectedIndex];
                    if (selectedResource) {
                        insertResource(selectedResource);
                    }
                    return true;
                }

                case 'Escape':
                    event.preventDefault();
                    setState((prev) => ({ ...prev, isOpen: false }));
                    return true;
            }

            return false;
        },
        [state]
    );

    // Insert selected resource into textarea
    const insertResource = useCallback(
        (resource: ResourceMetadata) => {
            if (!textareaRef.current || state.triggerPosition === -1) return;

            const textarea = textareaRef.current;
            const currentText = textarea.value;

            // Determine the reference format to insert
            let referenceText: string;
            if (resource.serverName && resource.name) {
                referenceText = `@${resource.serverName}:${resource.name}`;
            } else if (resource.name) {
                referenceText = `@${resource.name}`;
            } else {
                referenceText = `@<${resource.uri}>`;
            }

            // Find the end of the current partial @ reference
            // Look for the end of the query after @
            const textFromTrigger = currentText.substring(state.triggerPosition);
            const match = textFromTrigger.match(/^@[^\s\n]*/);
            const endPosition = state.triggerPosition + (match ? match[0].length : 1);

            // Replace the @ reference with the selected resource
            const newText =
                currentText.substring(0, state.triggerPosition) +
                referenceText +
                ' ' +
                currentText.substring(endPosition);

            // Create a proper React synthetic event to update the textarea
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value'
            )?.set;
            nativeTextAreaValueSetter?.call(textarea, newText);

            // Position cursor after the inserted reference and space
            const newCursorPosition = state.triggerPosition + referenceText.length + 1;
            textarea.setSelectionRange(newCursorPosition, newCursorPosition);

            // Trigger React's onChange event
            const event = new Event('input', { bubbles: true });
            textarea.dispatchEvent(event);

            // Close autocomplete
            setState((prev) => ({ ...prev, isOpen: false }));

            // Focus back to textarea
            setTimeout(() => textarea.focus(), 0);
        },
        [textareaRef, state.triggerPosition]
    );

    const closeAutocomplete = useCallback(() => {
        setState((_prev) => ({ ..._prev, isOpen: false }));
    }, []);

    return {
        ...state,
        handleTextChange,
        handleKeyDown,
        insertResource,
        closeAutocomplete,
    };
}
