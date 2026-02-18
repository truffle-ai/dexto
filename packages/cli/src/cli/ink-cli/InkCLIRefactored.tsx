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

function formatCost(c: number): string {
    if (c < 0.01) return `$${c.toFixed(4)}`;
    if (c < 1) return `$${c.toFixed(3)}`;
    return `$${c.toFixed(2)}`;
}

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
 * Options for starting the Ink CLI
 */
export interface InkCLIOptions {
    /** Update info if a newer version is available */
    updateInfo?: { current: string; latest: string; updateCommand: string } | undefined;
    /** True if installed agents differ from bundled and user should sync */
    needsAgentSync?: boolean | undefined;
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
        onApprovalRequired: true,
        onTaskComplete: true,
    };
    // Override with user preferences if they exist
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            soundConfig = {
                enabled: preferences.sounds?.enabled ?? soundConfig.enabled,
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
    if (soundConfig.enabled) {
        soundService = new SoundNotificationService(soundConfig);
    }

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

    // Register exit handler so commands can trigger graceful exit
    const { registerExitHandler } = await import(
        '../commands/interactive-commands/exit-handler.js'
    );
    registerExitHandler(() => inkApp.unmount());

    await inkApp.waitUntilExit();

    // Disable bracketed paste mode to restore normal terminal behavior
    disableBracketedPaste();

    // Display session stats if available (after Ink has unmounted)
    const { getExitStats, clearExitStats } = await import(
        '../commands/interactive-commands/exit-stats.js'
    );
    const exitStats = getExitStats();
    if (exitStats) {
        const chalk = (await import('chalk')).default;

        // Add visual separation - clear space like Gemini CLI does
        // This creates a clean slate showing only the exit command and summary
        process.stdout.write('\n'.repeat(1));

        process.stdout.write(chalk.bold.cyan('📊 Session Summary') + '\n');
        process.stdout.write(chalk.dim('─'.repeat(50)) + '\n');

        // Session ID
        if (exitStats.sessionId) {
            process.stdout.write(chalk.gray(`  Session ID:  ${exitStats.sessionId}`) + '\n');
        }

        // Duration
        if (exitStats.duration) {
            process.stdout.write(chalk.gray(`  Duration:    ${exitStats.duration}`) + '\n');
        }

        // Message count
        if (exitStats.messageCount.total > 0) {
            process.stdout.write(
                chalk.gray(
                    `  Messages:    ${exitStats.messageCount.total} total (${exitStats.messageCount.user} user, ${exitStats.messageCount.assistant} assistant)`
                ) + '\n'
            );
        }
        // Multi-model breakdown (if multiple models were used)
        if (exitStats.modelStats && exitStats.modelStats.length > 1) {
            process.stdout.write(chalk.gray('\n  Models Used:') + '\n');

            for (const modelStat of exitStats.modelStats) {
                const modelLabel = `${modelStat.model} (${modelStat.messageCount} msgs)`;
                process.stdout.write(chalk.gray(`    • ${modelLabel}`) + '\n');

                // Detailed token breakdown per model
                const tokens = modelStat.tokenUsage;
                process.stdout.write(
                    chalk.gray(`      Input tokens:       ${tokens.inputTokens.toLocaleString()}`) +
                        '\n'
                );
                process.stdout.write(
                    chalk.gray(
                        `      Output tokens:      ${tokens.outputTokens.toLocaleString()}`
                    ) + '\n'
                );
                process.stdout.write(
                    chalk.gray(
                        `      Reasoning tokens:   ${tokens.reasoningTokens.toLocaleString()}`
                    ) + '\n'
                );
                process.stdout.write(
                    chalk.gray(
                        `      Cache read tokens:  ${tokens.cacheReadTokens.toLocaleString()}`
                    ) + '\n'
                );
                process.stdout.write(
                    chalk.gray(
                        `      Cache write tokens: ${tokens.cacheWriteTokens.toLocaleString()}`
                    ) + '\n'
                );
                process.stdout.write(
                    chalk.gray(`      Total tokens:       ${tokens.totalTokens.toLocaleString()}`) +
                        '\n'
                );

                if (modelStat.estimatedCost > 0) {
                    process.stdout.write(
                        chalk.gray(
                            `      Cost:               ${formatCost(modelStat.estimatedCost)}`
                        ) + '\n'
                    );
                }
            }
        }

        // Token usage
        if (exitStats.tokenUsage) {
            const {
                inputTokens,
                outputTokens,
                reasoningTokens,
                cacheReadTokens,
                cacheWriteTokens,
                totalTokens,
            } = exitStats.tokenUsage;

            // Calculate cache savings percentage
            const totalInputWithCache = inputTokens + cacheReadTokens;
            const cacheSavingsPercent =
                totalInputWithCache > 0
                    ? ((cacheReadTokens / totalInputWithCache) * 100).toFixed(1)
                    : '0.0';

            process.stdout.write(chalk.gray('\n  Token Usage:') + '\n');
            process.stdout.write(
                chalk.gray(`    Input tokens:       ${inputTokens.toLocaleString()}`) + '\n'
            );
            process.stdout.write(
                chalk.gray(`    Output tokens:      ${outputTokens.toLocaleString()}`) + '\n'
            );
            process.stdout.write(
                chalk.gray(`    Reasoning tokens:   ${reasoningTokens.toLocaleString()}`) + '\n'
            );
            const cacheReadLabel =
                cacheReadTokens > 0
                    ? `${cacheReadTokens.toLocaleString()} (💰 ${cacheSavingsPercent}% savings)`
                    : cacheReadTokens.toLocaleString();
            process.stdout.write(chalk.gray(`    Cache read tokens:  ${cacheReadLabel}`) + '\n');
            process.stdout.write(
                chalk.gray(`    Cache write tokens: ${cacheWriteTokens.toLocaleString()}`) + '\n'
            );
            process.stdout.write(
                chalk.gray(`    Total tokens:       ${totalTokens.toLocaleString()}`) + '\n'
            );
        }

        // Estimated cost
        if (exitStats.estimatedCost !== undefined) {
            process.stdout.write(
                chalk.green(`\n  Estimated Cost: ${formatCost(exitStats.estimatedCost)}`) + '\n'
            );
        }

        process.stdout.write(chalk.dim('─'.repeat(50)) + '\n');
        process.stdout.write('\n' + chalk.rgb(255, 165, 0)('Exiting Dexto CLI. Goodbye!') + '\n');

        clearExitStats();
    }
}
