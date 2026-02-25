/**
 * useTerminalSize Hook
 *
 * Listens to terminal resize events and provides current dimensions.
 */

import { useState, useEffect } from 'react';

export interface TerminalSize {
    columns: number;
    rows: number;
}

/**
 * Hook that returns current terminal size and updates on resize
 */
export function useTerminalSize(): TerminalSize {
    const [size, setSize] = useState<TerminalSize>({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
    });

    useEffect(() => {
        function updateSize() {
            setSize({
                columns: process.stdout.columns || 80,
                rows: process.stdout.rows || 24,
            });
        }

        // Listen for resize events
        process.stdout.on('resize', updateSize);

        // Initial update in case size changed between render and effect
        updateSize();

        return () => {
            process.stdout.off('resize', updateSize);
        };
    }, []);

    return size;
}
