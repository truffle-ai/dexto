import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const q = url.searchParams.get('q') || '';
        const client = getDextoClient();
        const results = await client.searchSessions(q);
        return NextResponse.json(results);
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to search sessions' },
            { status }
        );
    }
}
