import { NextResponse } from 'next/server';
import { getDextoClient } from '../../../_client';

export async function POST(_req: Request, { params }: any) {
    try {
        const client = getDextoClient();
        const id = params.sessionId;
        const loadId = id === 'null' || id === 'undefined' ? null : id;
        await client.loadSession(loadId);
        // For compatibility, include a simple status and the current session after load
        const currentSessionId = await client.getCurrentSession().catch(() => null as any);
        return NextResponse.json({
            status: loadId ? 'loaded' : 'reset',
            sessionId: loadId,
            currentSession: currentSessionId,
        });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to load session' }, { status });
    }
}
