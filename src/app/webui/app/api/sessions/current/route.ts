import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk/index.js';

export async function GET(_req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const currentSessionId = await client.getCurrentSession();
        return NextResponse.json({ currentSessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to get current session' },
            { status }
        );
    }
}
