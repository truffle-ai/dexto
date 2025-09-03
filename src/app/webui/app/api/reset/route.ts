import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function POST(req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const { sessionId } = await req.json();
        await client.resetConversation(sessionId);
        return NextResponse.json({ status: 'reset initiated', sessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to reset conversation' },
            { status }
        );
    }
}
