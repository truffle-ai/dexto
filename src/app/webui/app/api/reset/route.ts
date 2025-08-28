import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const { sessionId } = body || {};
        const client = getDextoClient();
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
