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
 * Pattern from Gemini CLI: Static contains pre-rendered JSX elements.
 * Header must be in Static or it appears below the static content.
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
import { StatusBar } from '../StatusBar.js';
import { Footer } from '../Footer.js';

// Containers
import { InputContainer } from '../../containers/InputContainer.js';
import { OverlayContainer } from '../../containers/OverlayContainer.js';

interface StaticCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
}

export function StaticCLI({ agent, initialSessionId, startupInfo }: StaticCLIProps) {
    // Use shared CLI state (no keyboard scroll in Static mode)
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
        // No keyboard scroll handler - let terminal handle scrollback
    });

    // Split messages into finalized (static) and pending (dynamic)
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

    return (
        <Box flexDirection="column">
            {/* Static: header + finalized messages - rendered once to terminal scrollback */}
            <Static items={staticItems}>{(item) => item}</Static>

            {/* Dynamic: pending messages - re-render on updates */}
            {dynamicMessages.map((message) => (
                <MessageItem key={message.id} message={message} />
            ))}

            {/* Controls area */}
            <Box flexDirection="column" flexShrink={0}>
                <StatusBar
                    isProcessing={ui.isProcessing}
                    isThinking={ui.isThinking}
                    approvalQueueCount={approvalQueue.length}
                    exitWarningShown={ui.exitWarningShown}
                    copyModeEnabled={ui.copyModeEnabled}
                />

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
