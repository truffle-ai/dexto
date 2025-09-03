import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await params;
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        await client.loadSession(sessionId);
        return NextResponse.json({ status: 'loaded', sessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to load session' }, { status });
    }
}
