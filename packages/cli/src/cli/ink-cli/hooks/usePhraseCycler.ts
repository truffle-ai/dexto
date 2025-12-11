/**
 * usePhraseCycler Hook
 * Cycles through processing phrases and tips at regular intervals
 * Similar to gemini-cli's implementation
 *
 * Behavior:
 * - First request after startup: always shows a tip
 * - Subsequent requests: 1/6 chance to show tip, 5/6 chance for witty phrase
 * - Phrases cycle every 8 seconds during processing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getRandomPhrase } from '../constants/processingPhrases.js';
import { getRandomTip } from '../constants/tips.js';

export interface PhraseCyclerOptions {
    /** Whether the cycler is active (should only run during processing) */
    isActive: boolean;
    /** Interval in milliseconds between phrase changes (default: 8000ms = 8 seconds) */
    intervalMs?: number;
    /** Disable tips (only show witty phrases) */
    disableTips?: boolean;
}

export interface PhraseCyclerResult {
    /** Current phrase to display */
    phrase: string;
    /** Manually trigger a new phrase */
    nextPhrase: () => void;
}

// Track whether we've shown the first tip (persists across component remounts)
let hasShownFirstTip = false;

/**
 * Get a random phrase or tip based on probability
 * - First request: always tip
 * - After that: 1/6 chance tip, 5/6 chance phrase
 */
function getRandomPhraseOrTip(disableTips: boolean = false): string {
    if (disableTips) {
        return getRandomPhrase();
    }

    // First request always shows a tip
    if (!hasShownFirstTip) {
        hasShownFirstTip = true;
        return getRandomTip();
    }

    // 1/6 chance to show a tip (roughly 16.7%)
    const showTip = Math.random() < 1 / 6;
    return showTip ? getRandomTip() : getRandomPhrase();
}

/**
 * Hook that cycles through witty processing phrases and informative tips
 *
 * @param options - Configuration options
 * @returns Current phrase and control functions
 */
export function usePhraseCycler({
    isActive,
    intervalMs = 8000,
    disableTips = false,
}: PhraseCyclerOptions): PhraseCyclerResult {
    const [phrase, setPhrase] = useState(() => getRandomPhraseOrTip(disableTips));
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const nextPhrase = useCallback(() => {
        // Get a new phrase that's different from current
        let newPhrase = getRandomPhraseOrTip(disableTips);
        // Avoid showing the same phrase twice in a row
        let attempts = 0;
        while (newPhrase === phrase && attempts < 3) {
            newPhrase = getRandomPhraseOrTip(disableTips);
            attempts++;
        }
        setPhrase(newPhrase);
    }, [phrase, disableTips]);

    useEffect(() => {
        if (isActive) {
            // Set initial phrase when becoming active
            setPhrase(getRandomPhraseOrTip(disableTips));

            // Start cycling
            intervalRef.current = setInterval(() => {
                setPhrase(getRandomPhraseOrTip(disableTips));
            }, intervalMs);
        } else {
            // Clear interval when inactive
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isActive, intervalMs, disableTips]);

    return { phrase, nextPhrase };
}

/**
 * Reset the first tip flag (useful for testing)
 */
export function resetFirstTipFlag(): void {
    hasShownFirstTip = false;
}
