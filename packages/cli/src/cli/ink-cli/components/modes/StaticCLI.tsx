/**
 * StaticCLI - Static pattern rendering mode
 *
 * Uses Ink's Static component for copy-friendly terminal output.
 * Features:
 * - Static component for finalized messages (rendered to terminal scrollback)
 * - Native terminal scrolling and text selection
 * - No mouse event interception
 * - Simpler, more compatible with traditional terminal workflows
 *
 * Architecture:
 * - `messages` = finalized messages → rendered in <Static> (permanent output)
 * - `pendingMessages` = streaming/in-progress → rendered dynamically (redrawn)
 * This prevents duplicate output when streaming completes.
 */

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Box, Static, Text, useStdout } from 'ink';
import type { DextoAgent } from '@dexto/core';

// ANSI escape sequence to clear terminal (equivalent to ansiEscapes.clearTerminal)
const CLEAR_TERMINAL = '\x1B[2J\x1B[3J\x1B[H';

// Types
import type { StartupInfo } from '../../state/types.js';

// Hooks
import { useCLIState } from '../../hooks/useCLIState.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useGitBranch } from '../../hooks/useGitBranch.js';

// Components
import { Header } from '../chat/Header.js';
import { MessageItem } from '../chat/MessageItem.js';
import { QueuedMessagesDisplay } from '../chat/QueuedMessagesDisplay.js';
import { StatusBar } from '../StatusBar.js';
import { HistorySearchBar } from '../HistorySearchBar.js';
import { Footer } from '../Footer.js';
import { TodoPanel } from '../TodoPanel.js';

// Containers
import { InputContainer, type InputContainerHandle } from '../../containers/InputContainer.js';
import { OverlayContainer } from '../../containers/OverlayContainer.js';

interface StaticCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
    /** Whether to stream chunks or wait for complete response */
    useStreaming?: boolean;
}

export function StaticCLI({
    agent,
    initialSessionId,
    startupInfo,
    useStreaming = true,
}: StaticCLIProps) {
    // Use shared CLI state (no keyboard scroll in Static mode)
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
        // No keyboard scroll handler - let terminal handle scrollback
    });

    // Get current git branch name
    const branchName = useGitBranch();

    // Terminal resize handling - clear and re-render Static content
    const { write: stdoutWrite } = useStdout();
    const { columns: terminalWidth } = useTerminalSize();
    const [staticRemountKey, setStaticRemountKey] = useState(0);
    const isInitialMount = useRef(true);

    // Ref to InputContainer for programmatic submit
    const inputContainerRef = useRef<InputContainerHandle>(null);

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
                    `StaticCLI.handleSubmitPromptCommand failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        },
        [agent]
    );

    // Function to refresh static content (clear terminal and force re-render)
    const refreshStatic = useCallback(() => {
        stdoutWrite(CLEAR_TERMINAL);
        setStaticRemountKey((prev) => prev + 1);
    }, [stdoutWrite]);

    // Handle terminal resize - debounced refresh of static content
    useEffect(() => {
        // Skip initial mount to avoid unnecessary clear on startup
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        // Debounce resize handling (300ms)
        const handler = setTimeout(() => {
            refreshStatic();
        }, 300);

        return () => {
            clearTimeout(handler);
        };
    }, [terminalWidth, refreshStatic]);

    // Pre-render static items as JSX elements (Gemini pattern)
    // Header + finalized messages go in <Static> (rendered once, permanent)
    const staticItems = useMemo(() => {
        const items: React.ReactElement[] = [
            <Header
                key="header"
                modelName={session.modelName}
                sessionId={session.id || undefined}
                hasActiveSession={session.hasActiveSession}
                startupInfo={startupInfo}
            />,
            ...visibleMessages.map((msg) => (
                <MessageItem
                    key={msg.id}
                    message={msg}
                    terminalWidth={terminalWidth}
                    showReasoning={ui.showReasoning}
                />
            )),
        ];
        return items;
    }, [
        visibleMessages,
        session.modelName,
        session.id,
        session.hasActiveSession,
        startupInfo,
        terminalWidth,
        ui.showReasoning,
    ]);

    return (
        <Box flexDirection="column" width={terminalWidth}>
            {/* Static: header + finalized messages - rendered once to terminal scrollback */}
            {/* Key changes on resize to force full re-render after terminal clear */}
            <Static key={staticRemountKey} items={staticItems}>
                {(item) => item}
            </Static>

            {/* Dynamic: pending/streaming messages - re-rendered on updates */}
            {pendingMessages.map((message) => (
                <MessageItem
                    key={message.id}
                    message={message}
                    terminalWidth={terminalWidth}
                    showReasoning={ui.showReasoning}
                />
            ))}

            {/* Dequeued buffer: user messages waiting to be flushed to finalized */}
            {/* Rendered AFTER pending to guarantee correct visual order */}
            {dequeuedBuffer.map((message) => (
                <MessageItem
                    key={message.id}
                    message={message}
                    terminalWidth={terminalWidth}
                    showReasoning={ui.showReasoning}
                />
            ))}

            {/* Controls area */}
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
                    refreshStatic={refreshStatic}
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
