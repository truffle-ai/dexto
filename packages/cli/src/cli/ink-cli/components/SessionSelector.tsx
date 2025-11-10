import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DextoAgent, SessionMetadata } from '@dexto/core';

interface SessionSelectorProps {
    isVisible: boolean;
    onSelectSession: (sessionId: string) => void;
    onClose: () => void;
    agent: DextoAgent;
}

interface SessionOption {
    id: string;
    metadata: SessionMetadata | undefined;
    isCurrent: boolean;
}

export default function SessionSelector({
    isVisible,
    onSelectSession,
    onClose,
    agent,
}: SessionSelectorProps) {
    const [sessions, setSessions] = useState<SessionOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);
    const MAX_VISIBLE_ITEMS = 10;

    // Keep ref in sync
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    // Fetch sessions from agent
    useEffect(() => {
        if (!isVisible) return;

        let cancelled = false;
        setIsLoading(true);

        const fetchSessions = async () => {
            try {
                const sessionIds = await agent.listSessions();
                const currentId = agent.getCurrentSessionId();

                // Fetch metadata for all sessions
                const sessionList: SessionOption[] = await Promise.all(
                    sessionIds.map(async (id) => {
                        try {
                            const metadata = await agent.getSessionMetadata(id);
                            return {
                                id,
                                metadata,
                                isCurrent: id === currentId,
                            };
                        } catch {
                            return {
                                id,
                                metadata: undefined,
                                isCurrent: id === currentId,
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
                    console.error('Failed to fetch sessions:', error);
                    setSessions([]);
                    setIsLoading(false);
                }
            }
        };

        void fetchSessions();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent]);

    // Reset scroll when selection changes
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            setScrollOffset(Math.max(0, selectedIndex - MAX_VISIBLE_ITEMS + 1));
        }
    }, [selectedIndex, scrollOffset]);

    // Calculate visible items
    const visibleItems = useMemo(() => {
        return sessions.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    }, [sessions, scrollOffset]);

    // Format session display
    const formatSession = (session: SessionOption): string => {
        const parts: string[] = [];
        if (session.metadata?.title) {
            parts.push(session.metadata.title);
        }
        parts.push(session.id.slice(0, 8));
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

    // Handle keyboard navigation
    useInput(
        (input, key) => {
            if (!isVisible) return;

            const itemsLength = sessions.length;
            if (itemsLength === 0) return;

            if (key.upArrow) {
                setSelectedIndex((prev) => (prev - 1 + itemsLength) % itemsLength);
            }

            if (key.downArrow) {
                setSelectedIndex((prev) => (prev + 1) % itemsLength);
            }

            if (key.escape) {
                onClose();
            }

            if (key.return && itemsLength > 0) {
                const session = sessions[selectedIndexRef.current];
                if (session) {
                    onSelectSession(session.id);
                }
            }
        },
        { isActive: isVisible }
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>Loading sessions...</Text>
            </Box>
        );
    }

    if (sessions.length === 0) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>No sessions found</Text>
            </Box>
        );
    }

    const hasMoreAbove = scrollOffset > 0;
    const hasMoreBelow = scrollOffset + MAX_VISIBLE_ITEMS < sessions.length;

    return (
        <Box
            borderStyle="single"
            borderColor="cyan"
            flexDirection="column"
            height={Math.min(MAX_VISIBLE_ITEMS + 3, sessions.length + 3)}
        >
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>
                    Select Session ({selectedIndex + 1}/{sessions.length}) - ↑↓ to navigate, Enter
                    to select, Esc to close
                </Text>
            </Box>
            {hasMoreAbove && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>... ↑ ({scrollOffset} more above)</Text>
                </Box>
            )}
            {visibleItems.map((session, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                return (
                    <Box
                        key={session.id}
                        paddingX={1}
                        paddingY={0}
                        backgroundColor={isSelected ? 'cyan' : undefined}
                        flexDirection="row"
                    >
                        <Text color={isSelected ? 'black' : 'green'} bold>
                            {formatSession(session)}
                        </Text>
                        {session.isCurrent && (
                            <Text color={isSelected ? 'black' : 'cyan'} bold>
                                {' '}
                                ← Current
                            </Text>
                        )}
                    </Box>
                );
            })}
            {hasMoreBelow && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>
                        ... ↓ ({sessions.length - scrollOffset - MAX_VISIBLE_ITEMS} more below)
                    </Text>
                </Box>
            )}
        </Box>
    );
}
