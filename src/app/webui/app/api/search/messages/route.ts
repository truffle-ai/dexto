import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const q = url.searchParams.get('q') || '';
        const limit = url.searchParams.get('limit');
        const offset = url.searchParams.get('offset');
        const sessionId = url.searchParams.get('sessionId') || undefined;
        const role = url.searchParams.get('role') as any;

        const client = getDextoClient();
        const results = await client.searchMessages(q, {
            ...(limit ? { limit: Number(limit) } : {}),
            ...(offset ? { offset: Number(offset) } : {}),
            ...(sessionId ? { sessionId } : {}),
            ...(role ? { role } : {}),
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
