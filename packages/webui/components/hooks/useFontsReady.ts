import { useEffect, useState } from 'react';

// Returns true when the browser reports that page fonts are loaded.
// This lets us defer first-measure actions (like autosize) until
// typographic metrics are stable to avoid initial reflow.
export function useFontsReady(): boolean {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        // If Font Loading API is unavailable, assume ready to avoid blocking.
        const anyDoc = document as any;
        if (!anyDoc.fonts || !anyDoc.fonts.ready) {
            setReady(true);
            return;
        }

        let cancelled = false;
        anyDoc.fonts.ready.then(() => {
            if (!cancelled) setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return ready;
}
