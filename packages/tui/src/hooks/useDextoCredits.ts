/**
 * Dexto account state for the status line: signed in or not, and the credit balance,
 * refreshed after each reply.
 */
import { useEffect, useState } from 'react';
import type { TuiAgentBackend } from '../agent-backend.js';
import { currentSignIn, dextoCreditBalance } from '../host/index.js';

/**
 * The credit balance in USD while `enabled`; null when off or not known. Refetches when
 * `billingOverlayOpen` changes, since a top-up in the browser emits no agent event.
 */
export function useDextoCreditBalance(
    agent: TuiAgentBackend,
    sessionId: string | null,
    enabled: boolean,
    billingOverlayOpen: boolean
): number | null {
    const [balance, setBalance] = useState<number | null>(null);
    useEffect(() => {
        setBalance(null);
    }, [agent, sessionId, enabled]);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        const refresh = () => {
            dextoCreditBalance()
                .then((next) => {
                    if (!cancelled) setBalance(next);
                })
                .catch(() => undefined);
        };
        refresh();
        const controller = new AbortController();
        agent.on(
            'llm:response',
            (payload: { sessionId?: string }) => {
                if (!payload.sessionId || payload.sessionId === sessionId) refresh();
            },
            { signal: controller.signal }
        );
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [agent, sessionId, enabled, billingOverlayOpen]);
    return balance;
}

/**
 * Whether the user is signed in to Dexto. Checked at start, after each run, and whenever
 * `recheckKey` changes (the deck passes the active overlay, since /login and /logout are overlays).
 */
export function useDextoSignedIn(agent: TuiAgentBackend, recheckKey: string): boolean {
    const [signedIn, setSignedIn] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const check = () => {
            currentSignIn()
                .then((who) => {
                    if (!cancelled) setSignedIn(who !== null);
                })
                .catch(() => {
                    if (!cancelled) setSignedIn(false);
                });
        };
        check();
        const controller = new AbortController();
        agent.on('run:complete', check, { signal: controller.signal });
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [agent, recheckKey]);
    return signedIn;
}
