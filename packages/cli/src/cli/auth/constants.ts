// packages/cli/src/cli/auth/constants.ts
//
// Where the CLI reaches Dexto. Environment overrides, for previews and local development:
// - DEXTO_PLATFORM_URL: the Dexto app, home of its OAuth server and MCP (e.g. http://localhost:3002)
// - DEXTO_PUBLIC_API_URL: the versioned public API (e.g. http://localhost:3002)
// - DEXTO_CREDITS_URL: the page to buy credits on

/** The Dexto app a new sign-in goes to. */
export const DEXTO_PLATFORM_URL = process.env.DEXTO_PLATFORM_URL || 'https://app.dexto.ai';

/** The versioned public API (`/v1`). */
export const DEXTO_PUBLIC_API_URL = process.env.DEXTO_PUBLIC_API_URL || 'https://api.dexto.ai';

/** Where to buy Dexto credits. */
export const DEXTO_CREDITS_URL =
    process.env.DEXTO_CREDITS_URL || 'https://app.dexto.ai/dashboard/settings/billing';
