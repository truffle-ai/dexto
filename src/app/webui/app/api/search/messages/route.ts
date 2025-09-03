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
        const query = url.searchParams.get('q');
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const sessionId = url.searchParams.get('sessionId') || undefined;
        const role = url.searchParams.get('role') || undefined;

        if (!query) {
            return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
        }

        const results = await client.searchMessages(query, {
            limit,
            offset,
            sessionId,
            role: role as any,
        });

        return NextResponse.json(results);
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to search messages' },
            { status }
        );
    }
}
