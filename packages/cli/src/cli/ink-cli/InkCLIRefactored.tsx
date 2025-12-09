/**
 * InkCLI Component (Refactored)
 *
 * Main orchestrator component with simplified state management.
 *
 * Architecture:
 * - State managed via useState hooks (no reducer)
 * - Events from agent handled directly
 * - Business logic in services
 * - UI in presentational components
 */

import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { Box, Static, render, type DOMElement } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { registerGracefulShutdown } from '../../utils/graceful-shutdown.js';

// Rendering mode: true = alternate buffer with VirtualizedList, false = Static pattern
// Toggle this to switch between modes for testing
//const USE_ALTERNATE_BUFFER = true;
const USE_ALTERNATE_BUFFER = false;

// Types
import type { Message, OverlayType, McpWizardServerType, StartupInfo } from './state/types.js';
import type { ApprovalRequest } from './components/ApprovalPrompt.js';

// Custom hooks
import { useAgentEvents, useInputOrchestrator, useTerminalSize, type Key } from './hooks/index.js';

// Contexts (keyboard/mouse providers)
import {
    KeypressProvider,
    MouseProvider,
    ScrollProvider,
    useScrollable,
} from './contexts/index.js';

// Services
import { InputService, MessageService } from './services/index.js';

// Utils
import { getStartupInfo, convertHistoryToUIMessages } from './utils/messageFormatting.js';

// Components
import { Header } from './components/chat/Header.js';
import { MessageItem } from './components/chat/MessageItem.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';
import { Footer } from './components/Footer.js';
import {
    VirtualizedList,
    SCROLL_TO_ITEM_END,
    type VirtualizedListRef,
} from './components/shared/VirtualizedList.js';

// Union type for virtualized list items: header or message
type ListItem = { type: 'header' } | { type: 'message'; message: Message };

// Containers
import { InputContainer, type InputContainerHandle } from './containers/InputContainer.js';
import { OverlayContainer, type OverlayContainerHandle } from './containers/OverlayContainer.js';

interface InkCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
}

/**
 * UI state - grouped for convenience
 */
interface UIState {
    isProcessing: boolean;
    isCancelling: boolean;
    isThinking: boolean;
    activeOverlay: OverlayType;
    exitWarningShown: boolean;
    exitWarningTimestamp: number | null;
    mcpWizardServerType: McpWizardServerType;
    copyModeEnabled: boolean;
}

/**
 * Input state - grouped for convenience
 */
interface InputState {
    value: string;
    history: string[];
    historyIndex: number;
}

/**
 * Session state - grouped for convenience
 */
interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
    modelName: string;
}

/**
 * Inner component that uses the providers
 */
function InkCLIInner({ agent, initialSessionId, startupInfo }: InkCLIProps) {
    // Messages state
    const [messages, setMessages] = useState<Message[]>([]);

    // UI state
    const [ui, setUi] = useState<UIState>({
        isProcessing: false,
        isCancelling: false,
        isThinking: false,
        activeOverlay: 'none',
        exitWarningShown: false,
        exitWarningTimestamp: null,
        mcpWizardServerType: null,
        copyModeEnabled: false,
    });

    // Input state
    const [input, setInput] = useState<InputState>({
        value: '',
        history: [],
        historyIndex: -1,
    });

    // Session state
    const [session, setSession] = useState<SessionState>({
        id: initialSessionId,
        hasActiveSession: initialSessionId !== null,
        modelName: agent.getCurrentLLMConfig().model,
    });

    // Approval state
    const [approval, setApproval] = useState<ApprovalRequest | null>(null);
    const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([]);

    // Initialize services (memoized)
    const inputService = useMemo(() => new InputService(), []);
    const messageService = useMemo(() => new MessageService(), []);

    // Refs to container components for unified input handling
    const inputContainerRef = useRef<InputContainerHandle>(null);
    const overlayContainerRef = useRef<OverlayContainerHandle>(null);
    const listRef = useRef<VirtualizedListRef<ListItem>>(null);
    const listContainerRef = useRef<DOMElement>(null);

    // Setup event bus subscriptions - pass state setters for direct event handling
    useAgentEvents({
        agent,
        isCancelling: ui.isCancelling,
        setMessages,
        setUi,
        setSession,
        setApproval,
        setApprovalQueue,
    });

    // Create input handlers for the orchestrator
    // Approval handler - routes to OverlayContainer
    const approvalHandler = useCallback((inputStr: string, key: Key): boolean => {
        return overlayContainerRef.current?.handleInput(inputStr, key) ?? false;
    }, []);

    // Overlay handler - routes to OverlayContainer
    const overlayHandler = useCallback((inputStr: string, key: Key): boolean => {
        return overlayContainerRef.current?.handleInput(inputStr, key) ?? false;
    }, []);

    // Main input handler - routes to InputContainer with keyboard scroll support
    const inputHandler = useCallback((inputStr: string, key: Key): boolean => {
        // Handle keyboard scroll only in alternate buffer mode (VirtualizedList)
        // In Static mode, let terminal handle native scrollback
        if (USE_ALTERNATE_BUFFER) {
            if (key.pageUp || (key.shift && key.upArrow)) {
                listRef.current?.scrollBy(-10); // Scroll up 10 lines
                return true;
            }
            if (key.pageDown || (key.shift && key.downArrow)) {
                listRef.current?.scrollBy(10); // Scroll down 10 lines
                return true;
            }
        }

        return inputContainerRef.current?.handleInput(inputStr, key) ?? false;
    }, []);

    // Setup unified input orchestrator
    useInputOrchestrator({
        ui,
        approval,
        input,
        session,
        setUi,
        agent,
        handlers: {
            approval: approvalHandler,
            overlay: overlayHandler,
            input: inputHandler,
        },
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

    // Only register scrollable in alternate buffer mode
    // In Static mode, native terminal scrollback handles scrolling
    useScrollable(
        {
            ref: listContainerRef,
            getScrollState,
            scrollBy,
            hasFocus,
        },
        USE_ALTERNATE_BUFFER // Only active in alternate buffer mode
    );

    // Hydrate conversation history when resuming a session
    useEffect(() => {
        if (!initialSessionId || !session.hasActiveSession || messages.length > 0) {
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const history = await agent.getSessionHistory(initialSessionId);
                if (!history?.length || cancelled) return;
                const historyMessages = convertHistoryToUIMessages(history, initialSessionId);
                setMessages(historyMessages);
            } catch (error) {
                if (cancelled) return;
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `error-${Date.now()}`,
                        role: 'system',
                        content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                        timestamp: new Date(),
                    },
                ]);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [agent, initialSessionId, messages.length, session.hasActiveSession]);

    // Detect selector overlays based on exact command matches
    useEffect(() => {
        // Don't detect overlays if processing or approval is active
        if (ui.isProcessing || approval) return;

        // Early return for non-command input - no selector detection needed
        if (!input.value.startsWith('/')) return;

        // Only check for selector commands, not autocomplete
        const selectorType = inputService.detectInteractiveSelector(input.value);

        // Determine what selector overlay should be shown
        let desiredOverlay: OverlayType = 'none';
        switch (selectorType) {
            case 'model':
                desiredOverlay = 'model-selector';
                break;
            case 'session':
                desiredOverlay = 'session-selector';
                break;
        }

        // Overlays that should not be auto-closed (Enter-triggered or user-controlled)
        const protectedOverlays: OverlayType[] = [
            'slash-autocomplete',
            'resource-autocomplete',
            'log-level-selector',
            'mcp-selector',
            'mcp-add-selector',
            'mcp-remove-selector',
            'mcp-custom-type-selector',
            'mcp-custom-wizard',
            'session-subcommand-selector',
            'approval',
        ];
        const isProtectedOverlay = protectedOverlays.includes(ui.activeOverlay);

        // Only update overlay if different and not protected
        if (desiredOverlay !== ui.activeOverlay && !isProtectedOverlay) {
            setUi((prev) => ({ ...prev, activeOverlay: desiredOverlay }));
        }
    }, [input.value, ui.isProcessing, ui.activeOverlay, approval, inputService]);

    // Get visible messages
    const visibleMessages = useMemo(() => {
        return messageService.getVisibleMessages(messages, 50);
    }, [messages, messageService]);

    // Build list data: header as first item, then messages (for VirtualizedList mode)
    const listData = useMemo<ListItem[]>(() => {
        const items: ListItem[] = [{ type: 'header' }];
        for (const msg of visibleMessages) {
            items.push({ type: 'message', message: msg });
        }
        return items;
    }, [visibleMessages]);

    // For Static pattern: split messages into finalized (static) and pending (dynamic)
    // A message is finalized if it's not a running tool
    const { staticItems, dynamicMessages } = useMemo(() => {
        // Find cutoff - all messages before this are finalized
        let cutoff = 0;
        for (const msg of visibleMessages) {
            // Running tools are not finalized yet
            if (msg.toolStatus === 'running') {
                break;
            }
            cutoff++;
        }

        // Pre-render static items as JSX elements (Gemini pattern)
        // Header must be in Static or it appears below static content!
        const items: React.ReactElement[] = [
            <Header
                key="header"
                modelName={session.modelName}
                sessionId={session.id || undefined}
                hasActiveSession={session.hasActiveSession}
                startupInfo={startupInfo}
            />,
            ...visibleMessages
                .slice(0, cutoff)
                .map((msg) => <MessageItem key={msg.id} message={msg} />),
        ];

        return {
            staticItems: items,
            dynamicMessages: visibleMessages.slice(cutoff),
        };
    }, [visibleMessages, session.modelName, session.id, session.hasActiveSession, startupInfo]);

    // Get terminal dimensions - updates on resize
    const { rows: terminalHeight } = useTerminalSize();

    // Callbacks for VirtualizedList
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

    // Render content area based on mode
    const renderContentArea = () => {
        if (USE_ALTERNATE_BUFFER) {
            // VirtualizedList mode - scrollable, interactive
            return (
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
            );
        }

        // Static pattern mode - copy-friendly, uses terminal scrollback
        // Following Gemini's pattern: Static contains pre-rendered JSX elements
        // including header. Dynamic items render after in the "active" terminal area.
        return (
            <>
                {/* Static: header + finalized messages - rendered once to terminal scrollback */}
                <Static items={staticItems}>{(item) => item}</Static>

                {/* Dynamic: pending messages - re-render on updates */}
                {dynamicMessages.map((message) => (
                    <MessageItem key={message.id} message={message} />
                ))}
            </>
        );
    };

    return (
        <Box flexDirection="column" height={USE_ALTERNATE_BUFFER ? terminalHeight : undefined}>
            {/* Content area - either VirtualizedList or Static pattern */}
            {renderContentArea()}

            {/* Controls area - fixed at bottom */}
            <Box flexDirection="column" flexShrink={0}>
                <StatusBar
                    isProcessing={ui.isProcessing}
                    isThinking={ui.isThinking}
                    approvalQueueCount={approvalQueue.length}
                    exitWarningShown={ui.exitWarningShown}
                    copyModeEnabled={ui.copyModeEnabled}
                />

                <InputContainer
                    ref={inputContainerRef}
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

/**
 * Modern CLI interface using React Ink
 */
export function InkCLIRefactored({ agent, initialSessionId, startupInfo }: InkCLIProps) {
    return (
        <ErrorBoundary>
            <KeypressProvider>
                {/* Mouse events only in alternate buffer mode - Static mode uses native terminal selection */}
                <MouseProvider mouseEventsEnabled={USE_ALTERNATE_BUFFER}>
                    <ScrollProvider>
                        <InkCLIInner
                            agent={agent}
                            initialSessionId={initialSessionId}
                            startupInfo={startupInfo}
                        />
                    </ScrollProvider>
                </MouseProvider>
            </KeypressProvider>
        </ErrorBoundary>
    );
}

/**
 * Start the modern Ink-based CLI
 */
export async function startInkCliRefactored(
    agent: DextoAgent,
    initialSessionId: string | null
): Promise<void> {
    registerGracefulShutdown(() => agent, { inkMode: true });

    const startupInfo = await getStartupInfo(agent);

    const inkApp = render(
        <InkCLIRefactored
            agent={agent}
            initialSessionId={initialSessionId}
            startupInfo={startupInfo}
        />,
        {
            exitOnCtrlC: false,
            alternateBuffer: USE_ALTERNATE_BUFFER,
            // Incremental rendering works better with VirtualizedList
            // Static pattern doesn't need it (and may work better without)
            incrementalRendering: USE_ALTERNATE_BUFFER,
        }
    );

    await inkApp.waitUntilExit();
}
