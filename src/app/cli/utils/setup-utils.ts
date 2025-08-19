// src/app/cli/utils/setup-utils.ts

import { globalPreferencesExist, loadGlobalPreferences } from '@core/preferences/loader.js';
import { isDextoSourceCode, isDextoProject } from '@core/utils/execution-context.js';

/**
 * Check if this is a first-time user (no preferences file exists)
 * @returns true if user has never run setup
 */
export function isFirstTimeUser(): boolean {
    return !globalPreferencesExist();
}

/**
 * Check if user requires setup (missing, corrupted, or incomplete preferences)
 * Context-aware: only requires setup in global-cli context
 * @returns true if setup is required
 */
export async function requiresSetup(): Promise<boolean> {
    // Never require setup in dexto-source or dexto-project context (development environment)
    if (isDextoSourceCode() || isDextoProject()) {
        return false;
    }

    // No preferences at all - definitely requires setup
    if (isFirstTimeUser()) {
        return true;
    }

    // Check if preferences are valid and complete
    try {
        const preferences = await loadGlobalPreferences();

        // Check setup completion flag
        if (!preferences.setup.completed) {
            return true;
        }

        // Check required fields (will throw if missing due to schema)
        if (!preferences.defaults.defaultAgent) {
            return true;
        }

        return false; // Valid preferences - no setup required
    } catch (error) {
        // Corrupted or invalid preferences - requires setup
        return true;
    }
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
