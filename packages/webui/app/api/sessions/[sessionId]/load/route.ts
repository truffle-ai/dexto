import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await context.params;
        if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }
        const normalizedSessionId = sessionId.trim();
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

        await client.loadSession(normalizedSessionId);
        return NextResponse.json({ status: 'loaded', sessionId: normalizedSessionId });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to load session') },
            { status }
        );
    }
}
