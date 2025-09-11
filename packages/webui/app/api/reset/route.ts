import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';

export async function POST(req: Request) {
    try {
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

        // Validate and parse JSON body
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        // Extract and type-guard sessionId
        const sessionId = (body as Record<string, unknown>)?.sessionId;
        if (sessionId !== undefined && typeof sessionId !== 'string') {
            return NextResponse.json(
                { error: 'sessionId must be a string if provided' },
                { status: 400 }
            );
        }

        // Proceed with reset
        await client.resetConversation(sessionId as string | undefined);
        return NextResponse.json({ status: 'reset initiated', sessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to reset conversation' },
            { status }
        );
    }
}
