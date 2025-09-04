import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk/index.js';

export async function POST(req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        if (typeof body !== 'object' || body === null) {
            return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
        }
        const { sessionId, ...config } = body as Record<string, unknown>;
        const sid = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined;
        const newConfig = await client.switchLLM(config as any, sid);
        return NextResponse.json({ config: newConfig });
    } catch (err: unknown) {
        const anyErr = err as { statusCode?: number; message?: string };
        const status = anyErr?.statusCode || 500;
        return NextResponse.json({ error: anyErr?.message || 'Failed to switch LLM' }, { status });
    }
}
