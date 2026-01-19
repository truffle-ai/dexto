/**
 * SessionSelector Component (Refactored)
 * Now a thin wrapper around BaseSelector
 * Eliminates ~200 lines of code by using base component
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent, SessionMetadata } from '@dexto/core';
import { logger } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface SessionSelectorProps {
    isVisible: boolean;
    onSelectSession: (sessionId: string) => void;
    onClose: () => void;
    agent: DextoAgent;
    currentSessionId?: string | undefined;
}

export interface SessionSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface SessionOption {
    id: string;
    metadata: SessionMetadata | undefined;
    isCurrent: boolean;
}

/**
 * Session selector - now a thin wrapper around BaseSelector
 * Provides data fetching and formatting only
 * Uses explicit currentSessionId prop (WebUI pattern) instead of getCurrentSessionId
 */
const SessionSelector = forwardRef<SessionSelectorHandle, SessionSelectorProps>(
    function SessionSelector(
        { isVisible, onSelectSession, onClose, agent, currentSessionId },
        ref
    ) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);

        // Forward handleInput to BaseSelector
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        const [sessions, setSessions] = useState<SessionOption[]>([]);
        const [isLoading, setIsLoading] = useState(false);
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Fetch sessions from agent
        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;
            setIsLoading(true);

            const fetchSessions = async () => {
                try {
                    const sessionIds = await agent.listSessions();

                    // Fetch metadata for all sessions
                    const sessionList: SessionOption[] = await Promise.all(
                        sessionIds.map(async (id) => {
                            try {
                                const metadata = await agent.getSessionMetadata(id);
                                return {
                                    id,
                                    metadata,
                                    isCurrent: id === currentSessionId,
                                };
                            } catch {
                                return {
                                    id,
                                    metadata: undefined,
                                    isCurrent: id === currentSessionId,
                                };
                            }
                        })
                    );

                    // Sort: current session first, then by last activity
                    sessionList.sort((a, b) => {
                        if (a.isCurrent) return -1;
                        if (b.isCurrent) return 1;
                        const aTime = a.metadata?.lastActivity || 0;
                        const bTime = b.metadata?.lastActivity || 0;
                        return bTime - aTime; // Most recent first
                    });

                    if (!cancelled) {
                        setSessions(sessionList);
                        setIsLoading(false);
                        // Current session is first, so index 0
                        setSelectedIndex(0);
                    }
                } catch (error) {
                    if (!cancelled) {
                        logger.error(
                            `Failed to fetch sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            { error }
                        );
                        setSessions([]);
                        setIsLoading(false);
                    }
                }
            };

            void fetchSessions();

            return () => {
                cancelled = true;
            };
        }, [isVisible, agent, currentSessionId]);

        // Format session for display
        const formatSession = (session: SessionOption): string => {
            const parts: string[] = [];

            // Add title if available, otherwise use "New Session" as fallback
            if (session.metadata?.title) {
                parts.push(session.metadata.title);
            } else {
                parts.push('New Session');
            }

            // Always show short ID
            parts.push(session.id.slice(0, 8));

            // Show last activity time if available
            if (session.metadata?.lastActivity) {
                const now = Date.now();
                const diff = now - session.metadata.lastActivity;
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);
                if (days > 0) {
                    parts.push(`${days}d ago`);
                } else if (hours > 0) {
                    parts.push(`${hours}h ago`);
                } else if (minutes > 0) {
                    parts.push(`${minutes}m ago`);
                } else {
                    parts.push('just now');
                }
            }
            return parts.join(' • ');
        };

        // Format session item for display
        const formatItem = (session: SessionOption, isSelected: boolean) => (
            <>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                    {formatSession(session)}
                </Text>
                {session.isCurrent && (
                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                        {' '}
                        ← Current
                    </Text>
                )}
            </>
        );

        // Handle selection
        const handleSelect = (session: SessionOption) => {
            onSelectSession(session.id);
        };

        return (
            <BaseSelector
                ref={baseSelectorRef}
                items={sessions}
                isVisible={isVisible}
                isLoading={isLoading}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onSelect={handleSelect}
                onClose={onClose}
                formatItem={formatItem}
                title="Select Session"
                borderColor="cyan"
                loadingMessage="Loading sessions..."
                emptyMessage="No sessions found"
            />
        );
    }
);

export default SessionSelector;
