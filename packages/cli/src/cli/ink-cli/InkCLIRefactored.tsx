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
    initialPrompt?: string | undefined;
    startupInfo: StartupInfo;
    soundService: SoundNotificationService | null;
    configFilePath: string | null;
}

/**
 * Inner component that wraps the mode-specific component with providers
 */
function InkCLIInner({
    agent,
    initialSessionId,
    initialPrompt,
    startupInfo,
    soundService,
    configFilePath,
}: InkCLIProps) {
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
                        initialPrompt={initialPrompt}
                        startupInfo={startupInfo}
                        onSelectionAttempt={handleSelectionAttempt}
                        useStreaming={streaming}
                        configFilePath={configFilePath}
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
                initialPrompt={initialPrompt}
                startupInfo={startupInfo}
                useStreaming={streaming}
                configFilePath={configFilePath}
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
    initialPrompt,
    startupInfo,
    soundService,
    configFilePath,
}: InkCLIProps) {
    return (
        <ErrorBoundary>
            <KeypressProvider>
                {/* Mouse events only in alternate buffer mode - Static mode uses native terminal selection */}
                <MouseProvider mouseEventsEnabled={USE_ALTERNATE_BUFFER}>
                    <InkCLIInner
                        agent={agent}
                        initialSessionId={initialSessionId}
                        initialPrompt={initialPrompt}
                        startupInfo={startupInfo}
                        soundService={soundService}
                        configFilePath={configFilePath}
                    />
                </MouseProvider>
            </KeypressProvider>
        </ErrorBoundary>
    );
}

/**
 * Options for starting the Ink CLI
 */
export interface InkCLIOptions {
    /** Update info if a newer version is available */
    updateInfo?: { current: string; latest: string; updateCommand: string } | undefined;
    /** True if installed agents differ from bundled and user should sync */
    needsAgentSync?: boolean | undefined;
    /** Source agent config file path (if available) */
    configFilePath?: string | null | undefined;
    /** If provided, auto-submits this prompt once the UI is ready */
    initialPrompt?: string | undefined;
}

/**
 * Start the modern Ink-based CLI
 */
export async function startInkCliRefactored(
    agent: DextoAgent,
    initialSessionId: string | null,
    options: InkCLIOptions = {}
): Promise<void> {
    registerGracefulShutdown(() => agent, { inkMode: true });

    // Enable bracketed paste mode so we can detect pasted text
    // This wraps pastes with escape sequences that our KeypressContext handles
    enableBracketedPaste();

    // The UI can render before any session is created.
    const baseStartupInfo = await getStartupInfo(agent, initialSessionId);

    const startupInfo = {
        ...baseStartupInfo,
        updateInfo: options.updateInfo,
        needsAgentSync: options.needsAgentSync,
    };

    // Initialize sound service from preferences
    const { SoundNotificationService } = await import('./utils/soundNotification.js');
    const {
        globalPreferencesExist,
        loadGlobalPreferences,
        agentPreferencesExist,
        loadAgentPreferences,
    } = await import('@dexto/agent-management');

    let soundService: SoundNotificationService | null = null;
    // Initialize sound config with defaults (enabled by default even without preferences file)
    let soundConfig = {
        enabled: true,
        onStartup: true,
        onApprovalRequired: true,
        onTaskComplete: true,
    };
    // Override with user preferences if they exist
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            soundConfig = {
                enabled: preferences.sounds?.enabled ?? soundConfig.enabled,
                onStartup: preferences.sounds?.onStartup ?? soundConfig.onStartup,
                onApprovalRequired:
                    preferences.sounds?.onApprovalRequired ?? soundConfig.onApprovalRequired,
                onTaskComplete: preferences.sounds?.onTaskComplete ?? soundConfig.onTaskComplete,
            };
        } catch (error) {
            // Log at debug level to help troubleshoot sound configuration issues
            // Continue with default sounds - this is non-critical functionality
            agent.logger.debug(
                `Sound preferences could not be loaded: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    // Always create the service so sound settings can be toggled at runtime (service gates playback by config)
    soundService = new SoundNotificationService(soundConfig);
    soundService.playStartupSound();

    // Initialize tool preferences (per-agent)
    if (agentPreferencesExist(agent.config.agentId)) {
        try {
            const preferences = await loadAgentPreferences(agent.config.agentId);
            agent.setGlobalDisabledTools(preferences.tools?.disabled ?? []);
        } catch (error) {
            agent.logger.debug(
                `Agent tool preferences could not be loaded: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    const inkApp = render(
        <InkCLIRefactored
            agent={agent}
            initialSessionId={initialSessionId}
            initialPrompt={options.initialPrompt}
            startupInfo={startupInfo}
            soundService={soundService}
            configFilePath={options.configFilePath ?? null}
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
