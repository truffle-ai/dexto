import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk/index.js';

export async function GET(req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const url = new URL(req.url);
        const raw = url.searchParams.get('q');
        const query = raw?.trim() ?? '';
        if (!query) {
            return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
        }

        const results = await client.searchSessions(query);
        return NextResponse.json(results);
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to search sessions' },
            { status }
        );
    }
}
