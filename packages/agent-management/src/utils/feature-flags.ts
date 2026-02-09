/**
 * Feature flags for Dexto
 *
 * These flags control the availability of features that are in development
 * or being rolled out gradually.
 */

/**
 * Check if Dexto authentication/provider is enabled.
 *
 * When disabled (set DEXTO_FEATURE_AUTH=false), the Dexto provider option is hidden from:
 * - Onboarding/setup wizard
 * - Model selectors (CLI and WebUI)
 * - LLM catalog API responses
 *
 * The underlying auth commands (dexto login, logout, billing) remain functional
 * for users who need to manage their account.
 *
 * Enabled by default. Set DEXTO_FEATURE_AUTH=false to disable.
 */
export function isDextoAuthEnabled(): boolean {
    const flag = process.env.DEXTO_FEATURE_AUTH;
    if (flag === undefined) return true;
    return flag === 'true';
}
