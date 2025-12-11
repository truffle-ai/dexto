/**
 * ScrollProvider
 *
 * Manages scrollable components and handles mouse scroll events.
 * Components register themselves as scrollable, and the provider
 * routes scroll events to the appropriate component.
 */

import type React from 'react';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { getBoundingBox, type DOMElement } from 'ink';
import { useMouse, type MouseEvent } from './MouseContext.js';

export interface ScrollState {
    scrollTop: number;
    scrollHeight: number;
    innerHeight: number;
}

export interface ScrollableEntry {
    id: string;
    ref: React.RefObject<DOMElement | null>;
    getScrollState: () => ScrollState;
    scrollBy: (delta: number) => void;
    scrollTo?: (scrollTop: number, duration?: number) => void;
    hasFocus: () => boolean;
}

interface ScrollContextType {
    register: (entry: ScrollableEntry) => void;
    unregister: (id: string) => void;
}

const ScrollContext = createContext<ScrollContextType | null>(null);

/**
 * Find scrollable components under the mouse cursor
 */
const findScrollableCandidates = (
    mouseEvent: MouseEvent,
    scrollables: Map<string, ScrollableEntry>
) => {
    const candidates: Array<ScrollableEntry & { area: number }> = [];

    for (const entry of scrollables.values()) {
        if (!entry.ref.current || !entry.hasFocus()) {
            continue;
        }

        const boundingBox = getBoundingBox(entry.ref.current);
        if (!boundingBox) continue;

        const { x, y, width, height } = boundingBox;

        // Check if mouse is inside this component
        // Add 1 to width to include scrollbar column
        const isInside =
            mouseEvent.col >= x &&
            mouseEvent.col < x + width + 1 &&
            mouseEvent.row >= y &&
            mouseEvent.row < y + height;

        if (isInside) {
            candidates.push({ ...entry, area: width * height });
        }
    }

    // Sort by smallest area first (innermost component)
    candidates.sort((a, b) => a.area - b.area);
    return candidates;
};

export interface ScrollProviderProps {
    children: React.ReactNode;
    /** Callback when user attempts to select text (drag without Option key) */
    onSelectionAttempt?: () => void;
}

/**
 * Hook to detect text selection attempts (click + drag)
 * Returns a handler to process mouse events for drag detection
 */
function useDragDetection(onSelectionAttempt?: () => void) {
    const isLeftButtonDownRef = useRef(false);
    const selectionHintShownRef = useRef(false);

    const handleDragDetection = useCallback(
        (event: MouseEvent) => {
            if (event.name === 'left-press') {
                isLeftButtonDownRef.current = true;
                selectionHintShownRef.current = false;
            } else if (event.name === 'left-release') {
                isLeftButtonDownRef.current = false;
            } else if (event.name === 'move' && isLeftButtonDownRef.current) {
                // User is dragging (trying to select text)
                // Only show hint once per drag operation
                if (!selectionHintShownRef.current && onSelectionAttempt) {
                    selectionHintShownRef.current = true;
                    onSelectionAttempt();
                }
            }
        },
        [onSelectionAttempt]
    );

    return handleDragDetection;
}

export const ScrollProvider: React.FC<ScrollProviderProps> = ({ children, onSelectionAttempt }) => {
    const [scrollables, setScrollables] = useState(new Map<string, ScrollableEntry>());

    // Drag detection for selection hint
    const handleDragDetection = useDragDetection(onSelectionAttempt);

    const register = useCallback((entry: ScrollableEntry) => {
        setScrollables((prev) => new Map(prev).set(entry.id, entry));
    }, []);

    const unregister = useCallback((id: string) => {
        setScrollables((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
        });
    }, []);

    const scrollablesRef = useRef(scrollables);
    useEffect(() => {
        scrollablesRef.current = scrollables;
    }, [scrollables]);

    // Batch scroll events to prevent jitter
    const pendingScrollsRef = useRef(new Map<string, number>());
    const flushScheduledRef = useRef(false);

    const scheduleFlush = useCallback(() => {
        if (!flushScheduledRef.current) {
            flushScheduledRef.current = true;
            setTimeout(() => {
                flushScheduledRef.current = false;
                for (const [id, delta] of pendingScrollsRef.current.entries()) {
                    const entry = scrollablesRef.current.get(id);
                    if (entry) {
                        entry.scrollBy(delta);
                    }
                }
                pendingScrollsRef.current.clear();
            }, 0);
        }
    }, []);

    const handleScroll = useCallback(
        (direction: 'up' | 'down', mouseEvent: MouseEvent): boolean => {
            const delta = direction === 'up' ? -1 : 1;
            const candidates = findScrollableCandidates(mouseEvent, scrollablesRef.current);

            for (const candidate of candidates) {
                const { scrollTop, scrollHeight, innerHeight } = candidate.getScrollState();
                const pendingDelta = pendingScrollsRef.current.get(candidate.id) || 0;
                const effectiveScrollTop = scrollTop + pendingDelta;

                // Epsilon for floating point comparison
                const canScrollUp = effectiveScrollTop > 0.001;
                const canScrollDown = effectiveScrollTop < scrollHeight - innerHeight - 0.001;

                if (direction === 'up' && canScrollUp) {
                    pendingScrollsRef.current.set(candidate.id, pendingDelta + delta);
                    scheduleFlush();
                    return true;
                }

                if (direction === 'down' && canScrollDown) {
                    pendingScrollsRef.current.set(candidate.id, pendingDelta + delta);
                    scheduleFlush();
                    return true;
                }
            }
            return false;
        },
        [scheduleFlush]
    );

    // Subscribe to mouse events
    useMouse(
        useCallback(
            (event: MouseEvent) => {
                // Handle scroll events
                if (event.name === 'scroll-up') {
                    return handleScroll('up', event);
                } else if (event.name === 'scroll-down') {
                    return handleScroll('down', event);
                }

                // Detect selection attempts (click + drag)
                handleDragDetection(event);

                return false;
            },
            [handleScroll, handleDragDetection]
        ),
        { isActive: true }
    );

    const contextValue = useMemo(() => ({ register, unregister }), [register, unregister]);

    return <ScrollContext.Provider value={contextValue}>{children}</ScrollContext.Provider>;
};

let nextId = 0;

/**
 * Hook to register a component as scrollable
 */
export const useScrollable = (entry: Omit<ScrollableEntry, 'id'>, isActive: boolean) => {
    const context = useContext(ScrollContext);
    if (!context) {
        throw new Error('useScrollable must be used within a ScrollProvider');
    }

    const [id] = useState(() => `scrollable-${nextId++}`);

    // Store entry in ref to avoid re-registration on every render
    // when callers don't memoize the entry object
    const entryRef = useRef(entry);
    entryRef.current = entry;

    useEffect(() => {
        if (isActive) {
            // Build entry object, conditionally including scrollTo to satisfy exactOptionalPropertyTypes
            const registrationEntry: ScrollableEntry = {
                id,
                ref: entryRef.current.ref,
                getScrollState: () => entryRef.current.getScrollState(),
                scrollBy: (delta) => entryRef.current.scrollBy(delta),
                hasFocus: () => entryRef.current.hasFocus(),
            };
            if (entryRef.current.scrollTo) {
                registrationEntry.scrollTo = (scrollTop: number, duration?: number) => {
                    entryRef.current.scrollTo?.(scrollTop, duration);
                };
            }
            context.register(registrationEntry);
            return () => {
                context.unregister(id);
            };
        }
        return;
    }, [context, id, isActive]);
};
