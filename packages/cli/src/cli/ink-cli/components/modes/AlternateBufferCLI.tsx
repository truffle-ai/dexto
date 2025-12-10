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

import React, { useMemo, useCallback, useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import type { DextoAgent } from '@dexto/core';

// Types
import type { Message, StartupInfo } from '../../state/types.js';

// Hooks
import { useTerminalSize } from '../../hooks/index.js';
import { useCLIState } from '../../hooks/useCLIState.js';
import { useScrollable } from '../../contexts/index.js';

// Components
import { Header } from '../chat/Header.js';
import { MessageItem } from '../chat/MessageItem.js';
import { StatusBar } from '../StatusBar.js';
import { Footer } from '../Footer.js';
import {
    VirtualizedList,
    SCROLL_TO_ITEM_END,
    type VirtualizedListRef,
} from '../shared/VirtualizedList.js';

// Containers
import { InputContainer } from '../../containers/InputContainer.js';
import { OverlayContainer } from '../../containers/OverlayContainer.js';

// Union type for virtualized list items: header or message
type ListItem = { type: 'header' } | { type: 'message'; message: Message };

interface AlternateBufferCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
    /** Callback when user attempts to select text (drag without Option key) */
    onSelectionAttempt?: () => void;
}

export function AlternateBufferCLI({
    agent,
    initialSessionId,
    startupInfo,
    onSelectionAttempt,
}: AlternateBufferCLIProps) {
    // Refs for VirtualizedList
    const listRef = useRef<VirtualizedListRef<ListItem>>(null);
    const listContainerRef = useRef<DOMElement>(null);

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

    // Register the VirtualizedList as scrollable so ScrollProvider can handle mouse scroll
    const getScrollState = useCallback(() => {
        const scrollState = listRef.current?.getScrollState();
        return scrollState ?? { scrollTop: 0, scrollHeight: 0, innerHeight: 0 };
    }, []);

    const scrollBy = useCallback((delta: number) => {
        listRef.current?.scrollBy(delta);
    }, []);

    const hasFocus = useCallback(() => true, []); // List always has focus for scroll

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

        // Auto-hide after 3 seconds
        setTimeout(() => {
            setSelectionHintVisible(false);
        }, 3000);
    }, [onSelectionAttempt]);

    // Get terminal dimensions - updates on resize
    const { rows: terminalHeight } = useTerminalSize();

    // Build list data: header as first item, then messages
    const listData = useMemo<ListItem[]>(() => {
        const items: ListItem[] = [{ type: 'header' }];
        for (const msg of visibleMessages) {
            items.push({ type: 'message', message: msg });
        }
        return items;
    }, [visibleMessages]);

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
            return <MessageItem message={item.message} />;
        },
        [session.modelName, session.id, session.hasActiveSession, startupInfo]
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
                    approvalQueueCount={approvalQueue.length}
                    exitWarningShown={ui.exitWarningShown}
                    copyModeEnabled={ui.copyModeEnabled}
                />

                {/* Selection hint when user tries to select without Option key */}
                {selectionHintVisible && (
                    <Box paddingX={1}>
                        <Text color="yellow" dimColor>
                            💡 Tip: Hold Option (⌥) and click to select text, or press Ctrl+S to
                            toggle copy mode
                        </Text>
                    </Box>
                )}

                <InputContainer
                    buffer={buffer}
                    input={input}
                    ui={ui}
                    session={session}
                    approval={approval}
                    setInput={setInput}
                    setUi={setUi}
                    setSession={setSession}
                    setMessages={setMessages}
                    agent={agent}
                    inputService={inputService}
                    onKeyboardScroll={handleKeyboardScroll}
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
                />

                {/* Footer status line */}
                <Footer modelName={session.modelName} cwd={process.cwd()} />
            </Box>
        </Box>
    );
}
