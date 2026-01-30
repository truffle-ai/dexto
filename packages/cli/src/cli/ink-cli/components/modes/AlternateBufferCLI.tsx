/**
 * AlternateBufferCLI - VirtualizedList rendering mode
 *
 * Uses the terminal's alternate buffer for a fullscreen, scrollable UI.
 * Features:
 * - VirtualizedList for efficient message rendering
 * - Mouse scroll support via ScrollProvider
 * - Keyboard scroll (PageUp/PageDown, Shift+Arrow)
 * - Copy mode toggle (Ctrl+S)
 * - Selection hint when user tries to drag without Option key
 */

import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import type { DextoAgent } from '@dexto/core';

// Types
import type { Message, StartupInfo } from '../../state/types.js';

// Hooks
import { useTerminalSize } from '../../hooks/index.js';
import { useCLIState } from '../../hooks/useCLIState.js';
import { useGitBranch } from '../../hooks/useGitBranch.js';
import { useScrollable } from '../../contexts/index.js';

// Components
import { Header } from '../chat/Header.js';
import { MessageItem } from '../chat/MessageItem.js';
import { QueuedMessagesDisplay } from '../chat/QueuedMessagesDisplay.js';
import { StatusBar } from '../StatusBar.js';
import { HistorySearchBar } from '../HistorySearchBar.js';
import { Footer } from '../Footer.js';
import { TodoPanel } from '../TodoPanel.js';
import {
    VirtualizedList,
    SCROLL_TO_ITEM_END,
    type VirtualizedListRef,
} from '../shared/VirtualizedList.js';

// Containers
import { InputContainer, type InputContainerHandle } from '../../containers/InputContainer.js';
import { OverlayContainer } from '../../containers/OverlayContainer.js';

// Union type for virtualized list items: header or message
type ListItem = { type: 'header' } | { type: 'message'; message: Message };

interface AlternateBufferCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
    /** Callback when user attempts to select text (drag without Option key) */
    onSelectionAttempt?: () => void;
    /** Whether to stream chunks or wait for complete response */
    useStreaming?: boolean;
}

export function AlternateBufferCLI({
    agent,
    initialSessionId,
    startupInfo,
    onSelectionAttempt,
    useStreaming = true,
}: AlternateBufferCLIProps) {
    // Refs for VirtualizedList
    const listRef = useRef<VirtualizedListRef<ListItem>>(null);
    const listContainerRef = useRef<DOMElement>(null);

    // Ref to InputContainer for programmatic submit
    const inputContainerRef = useRef<InputContainerHandle>(null);

    // Selection hint state
    const [selectionHintVisible, setSelectionHintVisible] = useState(false);

    // Keyboard scroll handler for VirtualizedList
    const handleKeyboardScroll = useCallback((direction: 'up' | 'down') => {
        const delta = direction === 'up' ? -10 : 10;
        listRef.current?.scrollBy(delta);
    }, []);

    // Use shared CLI state with keyboard scroll handler
    const {
        messages,
        setMessages,
        pendingMessages,
        setPendingMessages,
        dequeuedBuffer,
        setDequeuedBuffer,
        queuedMessages,
        setQueuedMessages,
        todos,
        setTodos,
        ui,
        setUi,
        input,
        setInput,
        session,
        setSession,
        approval,
        setApproval,
        approvalQueue,
        setApprovalQueue,
        inputService,
        buffer,
        overlayContainerRef,
        visibleMessages,
    } = useCLIState({
        agent,
        initialSessionId,
        startupInfo,
        onKeyboardScroll: handleKeyboardScroll,
    });

    // Get current git branch name
    const branchName = useGitBranch();

    // Register the VirtualizedList as scrollable so ScrollProvider can handle mouse scroll
    const getScrollState = useCallback(() => {
        const scrollState = listRef.current?.getScrollState();
        return scrollState ?? { scrollTop: 0, scrollHeight: 0, innerHeight: 0 };
    }, []);

    const scrollBy = useCallback((delta: number) => {
        listRef.current?.scrollBy(delta);
    }, []);

    const hasFocus = useCallback(() => true, []); // List always has focus for scroll

    // Compute whether history search has a match (for HistorySearchBar indicator)
    const historySearchHasMatch = useMemo(() => {
        if (!ui.historySearch.isActive || !ui.historySearch.query) return false;
        const query = ui.historySearch.query.toLowerCase();
        return input.history.some((item) => item.toLowerCase().includes(query));
    }, [ui.historySearch.isActive, ui.historySearch.query, input.history]);

    // Callback for OverlayContainer to submit prompt commands through InputContainer
    const handleSubmitPromptCommand = useCallback(
        async (commandText: string) => {
            try {
                await inputContainerRef.current?.submit(commandText);
            } catch (error) {
                agent.logger.error(
                    `AlternateBufferCLI.handleSubmitPromptCommand failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        },
        [agent]
    );

    useScrollable(
        {
            ref: listContainerRef,
            getScrollState,
            scrollBy,
            hasFocus,
        },
        true // Always active in alternate buffer mode
    );

    // Handle selection attempt - show hint
    const handleSelectionAttempt = useCallback(() => {
        setSelectionHintVisible(true);
        onSelectionAttempt?.();
    }, [onSelectionAttempt]);

    // Auto-hide selection hint after 3 seconds
    useEffect(() => {
        if (!selectionHintVisible) return;
        const timer = setTimeout(() => {
            setSelectionHintVisible(false);
        }, 3000);
        return () => clearTimeout(timer);
    }, [selectionHintVisible]);

    // Get terminal dimensions - updates on resize
    const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();

    // Build list data: header as first item, then finalized + pending + dequeued buffer
    // In alternate buffer mode, everything is re-rendered anyway, so we combine all
    // Order: finalized messages → pending/streaming → dequeued user messages (guarantees order)
    // IMPORTANT: Deduplicate by ID to prevent race condition where a message appears in both
    // finalized (messages) and pending during the brief window between setState calls
    const listData = useMemo<ListItem[]>(() => {
        const items: ListItem[] = [{ type: 'header' }];
        const seenIds = new Set<string>();

        for (const msg of visibleMessages) {
            items.push({ type: 'message', message: msg });
            seenIds.add(msg.id);
        }
        // Add pending/streaming messages (skip if already in finalized - race condition guard)
        for (const msg of pendingMessages) {
            if (!seenIds.has(msg.id)) {
                items.push({ type: 'message', message: msg });
                seenIds.add(msg.id);
            }
        }
        // Add dequeued buffer (user messages waiting to be flushed to finalized)
        // These render AFTER pending to guarantee correct visual order
        for (const msg of dequeuedBuffer) {
            if (!seenIds.has(msg.id)) {
                items.push({ type: 'message', message: msg });
            }
        }
        return items;
    }, [visibleMessages, pendingMessages, dequeuedBuffer]);

    // Render callback for VirtualizedList items
    const renderListItem = useCallback(
        ({ item }: { item: ListItem }) => {
            if (item.type === 'header') {
                return (
                    <Header
                        modelName={session.modelName}
                        sessionId={session.id || undefined}
                        hasActiveSession={session.hasActiveSession}
                        startupInfo={startupInfo}
                    />
                );
            }
            return <MessageItem message={item.message} terminalWidth={terminalWidth} />;
        },
        [session.modelName, session.id, session.hasActiveSession, startupInfo, terminalWidth]
    );

    // Smart height estimation based on item type and content
    const estimateItemHeight = useCallback(
        (index: number) => {
            const item = listData[index];
            if (!item) return 3;

            // Header is approximately 10 lines (logo + info)
            if (item.type === 'header') {
                return 10;
            }

            const msg = item.message;

            // Tool messages with results are taller
            if (msg.role === 'tool') {
                if (msg.toolResult) {
                    const resultLines = Math.ceil(msg.toolResult.length / 80);
                    return Math.min(2 + resultLines, 10);
                }
                return 2;
            }

            // User messages have margin and background
            if (msg.role === 'user') {
                const contentLines = Math.ceil(msg.content.length / 80);
                return Math.max(3, contentLines + 2);
            }

            // Assistant messages
            if (msg.role === 'assistant') {
                if (msg.isStreaming) return 5;
                const contentLines = Math.ceil(msg.content.length / 80);
                return Math.max(2, contentLines + 1);
            }

            // System/styled messages
            if (msg.styledType) {
                return 8;
            }

            return 3;
        },
        [listData]
    );

    const getItemKey = useCallback((item: ListItem) => {
        if (item.type === 'header') return 'header';
        return item.message.id;
    }, []);

    return (
        <Box flexDirection="column" height={terminalHeight}>
            {/* Content area - VirtualizedList */}
            <Box ref={listContainerRef} flexGrow={1} flexShrink={1} minHeight={0}>
                <VirtualizedList
                    ref={listRef}
                    data={listData}
                    renderItem={renderListItem}
                    estimatedItemHeight={estimateItemHeight}
                    keyExtractor={getItemKey}
                    initialScrollIndex={SCROLL_TO_ITEM_END}
                    initialScrollOffsetInIndex={SCROLL_TO_ITEM_END}
                />
            </Box>

            {/* Controls area - fixed at bottom */}
            <Box flexDirection="column" flexShrink={0}>
                <StatusBar
                    agent={agent}
                    isProcessing={ui.isProcessing}
                    isThinking={ui.isThinking}
                    isCompacting={ui.isCompacting}
                    approvalQueueCount={approvalQueue.length}
                    copyModeEnabled={ui.copyModeEnabled}
                    isAwaitingApproval={approval !== null}
                    todoExpanded={ui.todoExpanded}
                    hasTodos={todos.some((t) => t.status !== 'completed')}
                    planModeActive={ui.planModeActive}
                    autoApproveEdits={ui.autoApproveEdits}
                />

                {/* Todo panel - shown below status bar */}
                <TodoPanel
                    todos={todos}
                    isExpanded={ui.todoExpanded}
                    isProcessing={ui.isProcessing}
                />

                {/* Selection hint when user tries to select without Option key */}
                {selectionHintVisible && (
                    <Box paddingX={1}>
                        <Text color="yellowBright">
                            💡 Tip: Hold Option (⌥) and click to select text, or press Ctrl+S to
                            toggle copy mode
                        </Text>
                    </Box>
                )}

                {/* Queued messages display (shows when messages are pending) */}
                <QueuedMessagesDisplay messages={queuedMessages} />

                <InputContainer
                    ref={inputContainerRef}
                    buffer={buffer}
                    input={input}
                    ui={ui}
                    session={session}
                    approval={approval}
                    queuedMessages={queuedMessages}
                    setInput={setInput}
                    setUi={setUi}
                    setSession={setSession}
                    setMessages={setMessages}
                    setPendingMessages={setPendingMessages}
                    setDequeuedBuffer={setDequeuedBuffer}
                    setQueuedMessages={setQueuedMessages}
                    setApproval={setApproval}
                    setApprovalQueue={setApprovalQueue}
                    setTodos={setTodos}
                    agent={agent}
                    inputService={inputService}
                    onKeyboardScroll={handleKeyboardScroll}
                    useStreaming={useStreaming}
                />

                <OverlayContainer
                    ref={overlayContainerRef}
                    ui={ui}
                    input={input}
                    session={session}
                    approval={approval}
                    setInput={setInput}
                    setUi={setUi}
                    setSession={setSession}
                    setMessages={setMessages}
                    setApproval={setApproval}
                    setApprovalQueue={setApprovalQueue}
                    agent={agent}
                    inputService={inputService}
                    buffer={buffer}
                    onSubmitPromptCommand={handleSubmitPromptCommand}
                />

                {/* Exit warning (Ctrl+C pressed once) - shown above footer */}
                {ui.exitWarningShown && (
                    <Box paddingX={1}>
                        <Text color="yellowBright" bold>
                            ⚠ Press Ctrl+C again to exit
                        </Text>
                        <Text color="gray"> (or press any key to cancel)</Text>
                    </Box>
                )}

                {/* Footer status line */}
                <Footer
                    agent={agent}
                    sessionId={session.id}
                    modelName={session.modelName}
                    cwd={process.cwd()}
                    {...(branchName ? { branchName } : {})}
                    autoApproveEdits={ui.autoApproveEdits}
                    planModeActive={ui.planModeActive}
                    isShellMode={buffer.text.startsWith('!')}
                />

                {/* History search bar (Ctrl+R) - shown at very bottom */}
                {ui.historySearch.isActive && (
                    <HistorySearchBar
                        query={ui.historySearch.query}
                        hasMatch={historySearchHasMatch}
                    />
                )}
            </Box>
        </Box>
    );
}
