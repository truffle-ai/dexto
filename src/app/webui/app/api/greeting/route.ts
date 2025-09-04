import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

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
        const sessionId = url.searchParams.get('sessionId') || undefined;
        const greeting = await client.getGreeting(sessionId);
        return NextResponse.json({ greeting });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to get greeting' }, { status });
    }
}
