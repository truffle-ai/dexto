import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';

export async function GET(req: Request) {
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

        const url = new URL(req.url);
        const raw = url.searchParams.get('q');
        const query = raw?.trim() ?? '';
        const limitRaw = url.searchParams.get('limit');
        const offsetRaw = url.searchParams.get('offset');
        const sessionId = url.searchParams.get('sessionId') || undefined;
        const roleRaw = url.searchParams.get('role') || undefined;

        if (!query) {
            return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
        }

        const limit = limitRaw === null ? 20 : Number(limitRaw);
        const offset = offsetRaw === null ? 0 : Number(offsetRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
            return NextResponse.json(
                { error: 'limit must be an integer between 1 and 200' },
                { status: 400 }
            );
        }
        if (!Number.isInteger(offset) || offset < 0) {
            return NextResponse.json(
                { error: 'offset must be a non-negative integer' },
                { status: 400 }
            );
        }

        const allowedRoles = new Set<string>(['user', 'assistant', 'system', 'tool']);
        const role =
            roleRaw && allowedRoles.has(roleRaw)
                ? (roleRaw as 'user' | 'assistant' | 'system' | 'tool')
                : undefined;

        const results = await client.searchMessages(query, {
            limit,
            offset,
            sessionId,
            role,
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
