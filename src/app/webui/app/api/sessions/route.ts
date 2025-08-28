import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client';

export async function GET() {
    try {
        const client = getDextoClient();
        const sessions = await client.listSessions();
        return NextResponse.json({ sessions });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to list sessions' }, { status });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const { sessionId } = body || {};
        const client = getDextoClient();
        const session = await client.createSession(sessionId);
        return NextResponse.json({ session }, { status: 201 });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to create session' }, { status });
    }
}
