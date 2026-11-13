/**
 * Whether this machine can use Dexto: signed in (`dexto login`) or DEXTO_API_KEY. Used by the CLI
 * and the local server's Web UI.
 */

import { defaultDextoGatewayOptions, dextoModelAccess } from '../auth/dexto-gateway.js';

/** Signed in to Dexto, or DEXTO_API_KEY is set. */
export async function isDextoAuthenticated(): Promise<boolean> {
    return (await dextoModelAccess(defaultDextoGatewayOptions())).status !== 'signed_out';
}

/** Dexto models can run now: signed in with permission to spend credits, or DEXTO_API_KEY. */
export async function canUseDextoProvider(): Promise<boolean> {
    return (await dextoModelAccess(defaultDextoGatewayOptions())).status === 'ready';
}
