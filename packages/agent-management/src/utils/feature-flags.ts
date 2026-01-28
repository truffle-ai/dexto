/**
 * Feature flags for Dexto
 *
 * These flags control the availability of features that are in development
 * or being rolled out gradually.
 */

/**
 * Check if Dexto authentication/provider is enabled.
 *
 * When disabled (default), the Dexto provider option is hidden from:
 * - Onboarding/setup wizard
 * - Model selectors (CLI and WebUI)
 * - LLM catalog API responses
 *
 * The underlying auth commands (dexto login, logout, billing) remain functional
 * for users who need to manage their account.
 *
 * Enable by setting DEXTO_FEATURE_AUTH=true in environment.
 */
export function isDextoAuthEnabled(): boolean {
    return process.env.DEXTO_FEATURE_AUTH === 'true';
}
