/**
 * InkCLI Component (Refactored)
 *
 * Entry point for the Ink-based CLI. Selects between two rendering modes:
 * - AlternateBufferCLI: VirtualizedList with mouse scroll, keyboard scroll, copy mode
 * - StaticCLI: Static pattern with native terminal scrollback and selection
 *
 * The mode is selected via USE_ALTERNATE_BUFFER constant.
 */

import React, { useCallback, useState } from 'react';
import { render } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { registerGracefulShutdown } from '../../utils/graceful-shutdown.js';
import { enableBracketedPaste, disableBracketedPaste } from './utils/bracketedPaste.js';

// Types
import type { StartupInfo } from './state/types.js';

// Contexts (keyboard/mouse providers)
import {
    KeypressProvider,
    MouseProvider,
    ScrollProvider,
    SoundProvider,
} from './contexts/index.js';

// Sound notification
import type { SoundNotificationService } from './utils/soundNotification.js';

// Components
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { AlternateBufferCLI, StaticCLI } from './components/modes/index.js';

// Hooks
import { useStreaming } from './hooks/useStreaming.js';

// Utils
import { getStartupInfo } from './utils/messageFormatting.js';

// Rendering mode: true = alternate buffer with VirtualizedList, false = Static pattern
// Toggle this to switch between modes for testing
//const USE_ALTERNATE_BUFFER = true;
const USE_ALTERNATE_BUFFER = false;

interface InkCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
    soundService: SoundNotificationService | null;
}

/**
 * Inner component that wraps the mode-specific component with providers
 */
function InkCLIInner({ agent, initialSessionId, startupInfo, soundService }: InkCLIProps) {
    // Selection hint callback for alternate buffer mode
    const [, setSelectionHintShown] = useState(false);

    // Streaming mode - can be toggled via /stream command
    const { streaming } = useStreaming();

    const handleSelectionAttempt = useCallback(() => {
        setSelectionHintShown(true);
    }, []);

    if (USE_ALTERNATE_BUFFER) {
        return (
            <SoundProvider soundService={soundService}>
                <ScrollProvider onSelectionAttempt={handleSelectionAttempt}>
                    <AlternateBufferCLI
                        agent={agent}
                        initialSessionId={initialSessionId}
                        startupInfo={startupInfo}
                        onSelectionAttempt={handleSelectionAttempt}
                        useStreaming={streaming}
                    />
                </ScrollProvider>
            </SoundProvider>
        );
    }

    // Static mode - no ScrollProvider needed
    return (
        <SoundProvider soundService={soundService}>
            <StaticCLI
                agent={agent}
                initialSessionId={initialSessionId}
                startupInfo={startupInfo}
                useStreaming={streaming}
            />
        </SoundProvider>
    );
}

/**
 * Modern CLI interface using React Ink
 *
 * Wraps the CLI with:
 * - ErrorBoundary for graceful error handling
 * - KeypressProvider for unified keyboard input
 * - MouseProvider (only in alternate buffer mode)
 */
export function InkCLIRefactored({
    agent,
    initialSessionId,
    startupInfo,
    soundService,
}: InkCLIProps) {
    return (
        <ErrorBoundary>
            <KeypressProvider>
                {/* Mouse events only in alternate buffer mode - Static mode uses native terminal selection */}
                <MouseProvider mouseEventsEnabled={USE_ALTERNATE_BUFFER}>
                    <InkCLIInner
                        agent={agent}
                        initialSessionId={initialSessionId}
                        startupInfo={startupInfo}
                        soundService={soundService}
                    />
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

    // Enable bracketed paste mode so we can detect pasted text
    // This wraps pastes with escape sequences that our KeypressContext handles
    enableBracketedPaste();

    const startupInfo = await getStartupInfo(agent);

    // Initialize sound service from preferences
    const { SoundNotificationService } = await import('./utils/soundNotification.js');
    const { globalPreferencesExist, loadGlobalPreferences } = await import(
        '@dexto/agent-management'
    );

    let soundService: SoundNotificationService | null = null;
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            // Sound defaults come from PreferenceSoundsSchema (enabled: true by default)
            const soundConfig = {
                enabled: preferences.sounds?.enabled ?? true,
                onApprovalRequired: preferences.sounds?.onApprovalRequired ?? true,
                onTaskComplete: preferences.sounds?.onTaskComplete ?? true,
            };
            if (soundConfig.enabled) {
                soundService = new SoundNotificationService(soundConfig);
            }
        } catch {
            // Preferences couldn't load - continue without sounds
        }
    }

    const inkApp = render(
        <InkCLIRefactored
            agent={agent}
            initialSessionId={initialSessionId}
            startupInfo={startupInfo}
            soundService={soundService}
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

    // Disable bracketed paste mode to restore normal terminal behavior
    disableBracketedPaste();
}
