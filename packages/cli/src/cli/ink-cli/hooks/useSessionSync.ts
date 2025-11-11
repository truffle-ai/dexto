/**
 * Hook for synchronizing session state with agent
 * Checks and updates session state periodically
 */

import { useEffect } from 'react';
import type { DextoAgent } from '@dexto/core';
import type { CLIAction } from '../state/actions.js';

interface UseSessionSyncProps {
    agent: DextoAgent;
    dispatch: React.Dispatch<CLIAction>;
    messageCount: number;
}

/**
 * Synchronizes session state with agent
 * Updates when messages change (indicating session activity)
 */
export function useSessionSync({ agent, dispatch, messageCount }: UseSessionSyncProps): void {
    // Check session on mount
    useEffect(() => {
        const checkSession = async () => {
            try {
                const sessionId = agent.getCurrentSessionId();
                const session = await agent.getSession(sessionId);
                dispatch({
                    type: 'SESSION_SET',
                    sessionId,
                    hasActiveSession: session !== undefined,
                });
            } catch {
                dispatch({
                    type: 'SESSION_SET',
                    sessionId: agent.getCurrentSessionId(),
                    hasActiveSession: false,
                });
            }
        };
        void checkSession();
    }, [agent, dispatch]);

    // Check session when messages change (session might be created)
    useEffect(() => {
        if (messageCount > 0) {
            const checkSession = async () => {
                try {
                    const sessionId = agent.getCurrentSessionId();
                    const session = await agent.getSession(sessionId);
                    dispatch({
                        type: 'SESSION_SET',
                        sessionId,
                        hasActiveSession: session !== undefined,
                    });
                } catch {
                    // Session doesn't exist yet
                }
            };
            void checkSession();
        }
    }, [agent, dispatch, messageCount]);
}
