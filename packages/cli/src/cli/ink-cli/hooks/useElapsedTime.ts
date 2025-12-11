/**
 * useElapsedTime Hook
 * Tracks elapsed time during processing with live updates
 */

import { useState, useEffect, useRef } from 'react';

export interface ElapsedTimeOptions {
    /** Whether timing is active (should only run during processing) */
    isActive: boolean;
    /** Update interval in milliseconds (default: 100ms) */
    intervalMs?: number;
}

export interface ElapsedTimeResult {
    /** Elapsed time in milliseconds */
    elapsedMs: number;
    /** Formatted elapsed time string (e.g., "1.2s", "1m 23s") */
    formatted: string;
}

/**
 * Format milliseconds into a human-readable string
 * - Under 1 minute: "1.2s"
 * - 1+ minutes: "1m 23s"
 * - 1+ hours: "1h 2m 3s"
 */
function formatElapsedTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);

    if (seconds < 60) {
        return `${seconds}.${tenths}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

/**
 * Hook that tracks elapsed time during processing
 *
 * @param options - Configuration options
 * @returns Elapsed time in ms and formatted string
 */
export function useElapsedTime({
    isActive,
    intervalMs = 100,
}: ElapsedTimeOptions): ElapsedTimeResult {
    const [elapsedMs, setElapsedMs] = useState(0);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isActive) {
            // Start timing
            startTimeRef.current = Date.now();
            setElapsedMs(0);

            // Update elapsed time at regular intervals
            intervalRef.current = setInterval(() => {
                if (startTimeRef.current !== null) {
                    setElapsedMs(Date.now() - startTimeRef.current);
                }
            }, intervalMs);
        } else {
            // Stop timing
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            startTimeRef.current = null;
            setElapsedMs(0);
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isActive, intervalMs]);

    return {
        elapsedMs,
        formatted: formatElapsedTime(elapsedMs),
    };
}
