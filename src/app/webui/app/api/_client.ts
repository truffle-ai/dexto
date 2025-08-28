import { DextoClient } from '@sdk';

export function getDextoClient(): DextoClient {
    const baseUrl = process.env.DEXTO_API_BASE_URL || 'http://localhost:3001';
    const apiKey = process.env.DEXTO_API_KEY;

    // Instantiate per request; lightweight and WS disabled in server routes
    return new DextoClient(
        {
            baseUrl,
            ...(apiKey ? { apiKey } : {}),
        },
        {
            enableWebSocket: false,
        }
    );
}
