// packages/cli/src/cli/utils/setup-utils.ts

import {
    globalPreferencesExist,
    loadGlobalPreferences,
    type GlobalPreferences,
} from '@dexto/agent-management';
import { getExecutionContext } from '@dexto/core';

/**
 * Check if this is a first-time user (no preferences file exists)
 * @returns true if user has never run setup
 */
export function isFirstTimeUser(): boolean {
    return !globalPreferencesExist();
}

/**
 * Result of checking setup state
 */
export interface SetupState {
    needsSetup: boolean;
    isFirstTime: boolean;
    apiKeyPending: boolean;
    baseURLPending: boolean;
    preferences: GlobalPreferences | null;
}

/**
 * Get detailed setup state including pending items
 * @returns Setup state with detailed flags
 */
export async function getSetupState(): Promise<SetupState> {
    const context = getExecutionContext();

    // Skip setup checks in dev mode when in source context
    if (context === 'dexto-source' && process.env.DEXTO_DEV_MODE === 'true') {
        return {
            needsSetup: false,
            isFirstTime: false,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }

    // Project context: skip (might have project-local config)
    if (context === 'dexto-project') {
        return {
            needsSetup: false,
            isFirstTime: false,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }

    // First-time user (no preferences)
    if (isFirstTimeUser()) {
        return {
            needsSetup: true,
            isFirstTime: true,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }

    // Has preferences - check state
    try {
        const preferences = await loadGlobalPreferences();

        // Check setup completion flag
        if (!preferences.setup.completed) {
            return {
                needsSetup: true,
                isFirstTime: false,
                apiKeyPending: false,
                baseURLPending: false,
                preferences,
            };
        }

        // Check required fields
        if (!preferences.defaults.defaultAgent) {
            return {
                needsSetup: true,
                isFirstTime: false,
                apiKeyPending: false,
                baseURLPending: false,
                preferences,
            };
        }

        // Setup is complete but may have pending items
        return {
            needsSetup: false,
            isFirstTime: false,
            apiKeyPending: preferences.setup.apiKeyPending ?? false,
            baseURLPending: preferences.setup.baseURLPending ?? false,
            preferences,
        };
    } catch (_error) {
        // Corrupted or invalid preferences
        return {
            needsSetup: true,
            isFirstTime: false,
            apiKeyPending: false,
            baseURLPending: false,
            preferences: null,
        };
    }
}

/**
 * Check if user requires setup (missing, corrupted, or incomplete preferences)
 * Context-aware:
 * - Dev mode (source + DEXTO_DEV_MODE): Skip setup, uses repo configs
 * - Project context: Skip setup (might have project-local config)
 * - First-time user (source/global-cli): Require setup
 * - Has preferences (source/global-cli): Validate them
 * @returns true if setup is required
 */
export async function requiresSetup(): Promise<boolean> {
    const state = await getSetupState();
    return state.needsSetup;
}

/**
 * Get appropriate guidance message based on user state
 */
export async function getSetupGuidanceMessage(): Promise<string> {
    if (isFirstTimeUser()) {
        return [
            "👋 Welcome to Dexto! Let's get you set up...",
            '',
            '🚀 Run `dexto setup` to configure your AI preferences',
            '   • Choose your AI provider (Google Gemini, OpenAI, etc.)',
            '   • Set up your API keys',
            '   • Configure your default agent',
            '',
            '💡 After setup, you can install agents with: `dexto install <agent-name>`',
        ].join('\n');
    }

    // Invalid, incomplete, or corrupted preferences
    return [
        '⚠️  Your Dexto preferences need attention',
        '',
        '🔧 Run `dexto setup` to fix your configuration',
        '   This will restore your AI provider settings and preferences',
    ].join('\n');
}
