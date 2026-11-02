/**
 * Dexto account state for the status line: signed in or not, and the credit balance,
 * refreshed after each reply.
 */
import { useEffect, useState } from 'react';
import type { TuiAgentBackend } from '../agent-backend.js';
import { currentSignIn, dextoCreditBalance } from '../host/index.js';

/**
 * The credit balance in USD of `account`; null when `account` is null or the balance is not
 * known. Refetches when `billingOverlayOpen` changes, since a top-up in the browser emits no
 * agent event.
 */
export function useDextoCreditBalance(
    agent: TuiAgentBackend,
    sessionId: string | null,
    account: string | null,
    billingOverlayOpen: boolean
): number | null {
    const [balance, setBalance] = useState<number | null>(null);
    useEffect(() => {
        setBalance(null);
    }, [agent, sessionId, account]);
    useEffect(() => {
        if (account === null) return;
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
    }, [agent, sessionId, account, billingOverlayOpen]);
    return balance;
}

/**
 * Who is signed in to Dexto, or null. Compared by label, so replacing one account with another
 * shows up even though the user stays signed in. Checked at start, after each run, and whenever
 * `recheckKey` changes (the deck passes the active overlay, since /login and /logout are overlays).
 */
export function useDextoAccount(agent: TuiAgentBackend, recheckKey: string): string | null {
    const [account, setAccount] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        const check = () => {
            currentSignIn()
                .then((who) => {
                    if (!cancelled) setAccount(who);
                })
                .catch(() => {
                    if (!cancelled) setAccount(null);
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
    return account;
}
