import { useEffect, useState, useRef, useCallback } from 'react';

export type ButtonId = 'customize' | 'tools' | 'memories' | 'theme' | 'settings';

interface UsePriorityOverflowOptions {
    priority: ButtonId[]; // Ordered by priority (highest first)
}

export function usePriorityOverflow({ priority }: UsePriorityOverflowOptions) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [hiddenButtons, setHiddenButtons] = useState<Set<ButtonId>>(new Set());
    const checkingRef = useRef(false);

    const checkOverflow = useCallback(() => {
        if (checkingRef.current) return; // Prevent re-entrant calls
        checkingRef.current = true;

        // Use RAF to batch updates and avoid infinite loops
        requestAnimationFrame(() => {
            const container = containerRef.current;
            if (!container) {
                checkingRef.current = false;
                return;
            }

            const containerRect = container.getBoundingClientRect();
            const allItems = Array.from(container.children[0]?.children || []) as HTMLElement[];
            const overflowMenu = container.querySelector('[data-overflow-menu]')
                ?.parentElement as HTMLElement;

            if (!overflowMenu || allItems.length === 0) {
                checkingRef.current = false;
                return;
            }

            const containerWidth = containerRect.width;
            const overflowMenuWidth = overflowMenu.offsetWidth + 8; // Include gap

            // Calculate total width of all currently visible buttons
            let totalButtonsWidth = 0;
            const buttonWidths = new Map<ButtonId, number>();

            allItems.forEach((item) => {
                const buttonId = item
                    .querySelector('[data-button-id]')
                    ?.getAttribute('data-button-id') as ButtonId;
                if (buttonId && priority.includes(buttonId)) {
                    const width = item.offsetWidth + 8; // Include gap
                    buttonWidths.set(buttonId, width);
                    totalButtonsWidth += width;
                }
            });

            // Check if overflow is needed
            const totalWidth = totalButtonsWidth + overflowMenuWidth;
            const newHidden = new Set<ButtonId>();

            if (totalWidth > containerWidth) {
                // Need to hide items - hide lowest priority first
                const reversePriority = [...priority].reverse();
                let widthToRemove = totalWidth - containerWidth;

                for (const buttonId of reversePriority) {
                    const buttonWidth = buttonWidths.get(buttonId);
                    if (buttonWidth) {
                        newHidden.add(buttonId);
                        widthToRemove -= buttonWidth;
                        if (widthToRemove <= 0) break;
                    }
                }
            }

            // Only update if changed to avoid unnecessary re-renders
            setHiddenButtons((prev) => {
                const hasChanged =
                    newHidden.size !== prev.size ||
                    Array.from(newHidden).some((id) => !prev.has(id));

                checkingRef.current = false;
                return hasChanged ? newHidden : prev;
            });
        });
    }, [priority]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Debounced check to avoid rapid re-checks
        let timeout: NodeJS.Timeout;
        const debouncedCheck = () => {
            clearTimeout(timeout);
            timeout = setTimeout(checkOverflow, 100);
        };

        // Initial check after mount
        timeout = setTimeout(checkOverflow, 0);

        // Observe container size changes
        const resizeObserver = new ResizeObserver(debouncedCheck);
        resizeObserver.observe(container);

        return () => {
            clearTimeout(timeout);
            resizeObserver.disconnect();
        };
    }, [checkOverflow]);

    return {
        containerRef,
        hiddenButtons,
        isButtonHidden: (id: ButtonId) => hiddenButtons.has(id),
    };
}
