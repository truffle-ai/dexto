import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';

export async function GET(req: Request, context: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await context.params;
        if (!sessionId || typeof sessionId !== 'string') {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }
        const client = new DextoClient(
            {
                baseUrl:
                    process.env.API_URL ||
                    process.env.NEXT_PUBLIC_API_URL ||
                    'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const history = await client.getSessionHistory(sessionId);
        return NextResponse.json({ history });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to get session history' },
            { status }
        );
    }
}
