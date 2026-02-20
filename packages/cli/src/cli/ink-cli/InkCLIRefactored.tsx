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
import type { SoundConfig, SoundNotificationService } from './utils/soundNotification.js';

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

    // Load preferences helpers (non-fatal if unavailable)
    let globalPreferencesExistFn: () => boolean = () => false;
    let loadGlobalPreferencesFn: (() => Promise<{ sounds?: Partial<SoundConfig> }>) | null = null;
    let agentPreferencesExistFn: (agentId: string) => boolean = () => false;
    let loadAgentPreferencesFn:
        | ((agentId: string) => Promise<{ tools?: { disabled?: string[] } }>)
        | null = null;

    try {
        const agentManagement = await import('@dexto/agent-management');
        globalPreferencesExistFn = agentManagement.globalPreferencesExist;
        loadGlobalPreferencesFn = agentManagement.loadGlobalPreferences;
        agentPreferencesExistFn = agentManagement.agentPreferencesExist;
        loadAgentPreferencesFn = agentManagement.loadAgentPreferences;
    } catch (error) {
        agent.logger.debug(
            `Preferences module could not be loaded: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    let soundService: SoundNotificationService | null = null;
    // Initialize sound config with defaults (enabled by default even without preferences file)
    let soundConfig: SoundConfig = {
        enabled: true,
        onStartup: true,
        startupSoundFile: undefined,
        onApprovalRequired: true,
        approvalSoundFile: undefined,
        onTaskComplete: true,
        completeSoundFile: undefined,
    };

    // Initialize sound service from preferences (non-fatal)
    try {
        const { SoundNotificationService: SoundNotificationServiceImpl } = await import(
            './utils/soundNotification.js'
        );

        // Override with user preferences if they exist
        if (globalPreferencesExistFn() && loadGlobalPreferencesFn) {
            try {
                const preferences = await loadGlobalPreferencesFn();
                soundConfig = {
                    enabled: preferences.sounds?.enabled ?? soundConfig.enabled,
                    onStartup: preferences.sounds?.onStartup ?? soundConfig.onStartup,
                    startupSoundFile:
                        preferences.sounds?.startupSoundFile ?? soundConfig.startupSoundFile,
                    onApprovalRequired:
                        preferences.sounds?.onApprovalRequired ?? soundConfig.onApprovalRequired,
                    approvalSoundFile:
                        preferences.sounds?.approvalSoundFile ?? soundConfig.approvalSoundFile,
                    onTaskComplete:
                        preferences.sounds?.onTaskComplete ?? soundConfig.onTaskComplete,
                    completeSoundFile:
                        preferences.sounds?.completeSoundFile ?? soundConfig.completeSoundFile,
                };
            } catch (error) {
                // Continue with default sounds - this is non-critical functionality
                agent.logger.debug(
                    `Sound preferences could not be loaded: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Always create the service so sound settings can be toggled at runtime (service gates playback by config)
        soundService = new SoundNotificationServiceImpl(soundConfig);
        soundService.playStartupSound();
    } catch (error) {
        agent.logger.debug(
            `Sound initialization failed: ${error instanceof Error ? error.message : String(error)}`
        );
        soundService = null;
    }

    // Initialize tool preferences (per-agent)
    if (agentPreferencesExistFn(agent.config.agentId) && loadAgentPreferencesFn) {
        try {
            const preferences = await loadAgentPreferencesFn(agent.config.agentId);
            agent.setGlobalDisabledTools(preferences.tools?.disabled ?? []);
        } catch (error) {
            agent.logger.debug(
                `Agent tool preferences could not be loaded: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    // Import exit handler before render to avoid race condition
    const { registerExitHandler } = await import(
        '../commands/interactive-commands/exit-handler.js'
    );

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

    // Register exit handler immediately after render (synchronous, before any await)
    registerExitHandler(() => inkApp.unmount());

    await inkApp.waitUntilExit();

    // Disable bracketed paste mode to restore normal terminal behavior
    disableBracketedPaste();

    // Display session stats if available (after Ink has unmounted)
    const chalk = (await import('chalk')).default;
    const { getExitStats, clearExitStats } = await import(
        '../commands/interactive-commands/exit-stats.js'
    );
    const exitStats = getExitStats();
    if (exitStats) {
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

                if (modelStat.estimatedCost !== undefined) {
                    process.stdout.write(
                        chalk.gray(
                            `      Cost:               ${formatCost(modelStat.estimatedCost)}`
                        ) + '\n'
                    );
                }
            }
        }

        // Token usage - label depends on whether multi-model was shown
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

            const tokenSectionLabel =
                exitStats.modelStats && exitStats.modelStats.length > 1
                    ? '\n  Total Token Usage:'
                    : '\n  Token Usage:';
            process.stdout.write(chalk.gray(tokenSectionLabel) + '\n');
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

        clearExitStats();
    }

    process.stdout.write(chalk.dim('─'.repeat(50)) + '\n');
    process.stdout.write('\n' + chalk.rgb(255, 165, 0)('Exiting Dexto CLI. Goodbye!') + '\n');
}
