// packages/cli/src/cli/utils/setup-utils.ts

import { globalPreferencesExist, loadGlobalPreferences } from '@dexto/agent-management';
import { getExecutionContext } from '@dexto/core';

/**
 * Check if this is a first-time user (no preferences file exists)
 * @returns true if user has never run setup
 */
export function isFirstTimeUser(): boolean {
    return !globalPreferencesExist();
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
    const context = getExecutionContext();

    // Skip setup in dev mode when in source context (maintainers testing with repo configs)
    if (context === 'dexto-source' && process.env.DEXTO_DEV_MODE === 'true') {
        return false;
    }

    // Project context: skip (might have project-local config)
    if (context === 'dexto-project') {
        return false;
    }

    // First-time user (no preferences) - require setup
    if (isFirstTimeUser()) {
        return true;
    }

    // Has preferences - validate them since we'll use them
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
    } catch (_error) {
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
