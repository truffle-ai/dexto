/**
 * Context usage for a session, refreshed on the events that change it.
 */
import { useEffect, useRef, useState } from 'react';
import { supportsContextStats, type TuiAgentBackend } from '../agent-backend.js';

export interface ContextUsage {
    /** Tokens in context: the last count the model reported, else the estimate. */
    usedTokens: number;
    maxTokens: number;
    usagePercent: number;
}

const REFRESH_EVENTS = [
    'llm:response',
    'context:compacted',
    'context:pruned',
    'context:cleared',
    'message:dequeued',
    'session:reset',
] as const;

/**
 * `onLlmSwitched` runs after a model switch for this session, so callers that read the LLM
 * config can re-render.
 */
export function useContextStats(
    agent: TuiAgentBackend,
    sessionId: string | null,
    onLlmSwitched: () => void
): ContextUsage | null {
    const [usage, setUsage] = useState<ContextUsage | null>(null);
    // A notification, not an input: a new callback identity must not refetch.
    const onSwitchedRef = useRef(onLlmSwitched);
    onSwitchedRef.current = onLlmSwitched;

    useEffect(() => {
        if (!supportsContextStats(agent) || !sessionId) {
            setUsage(null);
            return;
        }

        let cancelled = false;
        let refreshId = 0;

        const refresh = async () => {
            const requestId = ++refreshId;
            try {
                const stats = await agent.getContextStats(sessionId);
                if (cancelled || requestId !== refreshId) return;
                setUsage({
                    usedTokens: stats.actualTokens ?? stats.estimatedTokens,
                    maxTokens: stats.maxContextTokens,
                    usagePercent: stats.usagePercent,
                });
            } catch {
                if (!cancelled) setUsage(null);
            }
        };

        void refresh();

        const controller = new AbortController();
        const { signal } = controller;
        for (const eventName of REFRESH_EVENTS) {
            agent.on(
                eventName,
                (payload: { sessionId?: string }) => {
                    // Most session events include sessionId.
                    if (payload.sessionId && payload.sessionId !== sessionId) return;
                    void refresh();
                },
                { signal }
            );
        }
        agent.on(
            'llm:switched',
            (payload: { sessionIds?: string[] }) => {
                if (payload.sessionIds && !payload.sessionIds.includes(sessionId)) return;
                void refresh();
                onSwitchedRef.current();
            },
            { signal }
        );

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [agent, sessionId]);

    return usage;
}
