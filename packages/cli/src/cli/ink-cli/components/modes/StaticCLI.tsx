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

import React, { useMemo } from 'react';
import { Box, Static } from 'ink';
import type { DextoAgent } from '@dexto/core';

// Types
import type { StartupInfo } from '../../state/types.js';

// Hooks
import { useCLIState } from '../../hooks/useCLIState.js';

// Components
import { Header } from '../chat/Header.js';
import { MessageItem } from '../chat/MessageItem.js';
import { QueuedMessagesDisplay } from '../chat/QueuedMessagesDisplay.js';
import { StatusBar } from '../StatusBar.js';
import { Footer } from '../Footer.js';

// Containers
import { InputContainer } from '../../containers/InputContainer.js';
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
            ...visibleMessages.map((msg) => <MessageItem key={msg.id} message={msg} />),
        ];
        return items;
    }, [visibleMessages, session.modelName, session.id, session.hasActiveSession, startupInfo]);

    return (
        <Box flexDirection="column">
            {/* Static: header + finalized messages - rendered once to terminal scrollback */}
            <Static items={staticItems}>{(item) => item}</Static>

            {/* Dynamic: pending/streaming messages - re-rendered on updates */}
            {pendingMessages.map((message) => (
                <MessageItem key={message.id} message={message} />
            ))}

            {/* Dequeued buffer: user messages waiting to be flushed to finalized */}
            {/* Rendered AFTER pending to guarantee correct visual order */}
            {dequeuedBuffer.map((message) => (
                <MessageItem key={message.id} message={message} />
            ))}

            {/* Controls area */}
            <Box flexDirection="column" flexShrink={0}>
                <StatusBar
                    agent={agent}
                    isProcessing={ui.isProcessing}
                    isThinking={ui.isThinking}
                    approvalQueueCount={approvalQueue.length}
                    exitWarningShown={ui.exitWarningShown}
                    copyModeEnabled={ui.copyModeEnabled}
                />

                {/* Queued messages display (shows when messages are pending) */}
                <QueuedMessagesDisplay messages={queuedMessages} />

                <InputContainer
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
                />

                {/* Footer status line */}
                <Footer modelName={session.modelName} cwd={process.cwd()} />
            </Box>
        </Box>
    );
}
