import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET(_req: Request, { params }: any) {
    try {
        const client = getDextoClient();
        const session = await client.getSession(params.sessionId);
        return NextResponse.json({ session });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to get session' }, { status });
    }
}

export async function DELETE(_req: Request, { params }: any) {
    try {
        const client = getDextoClient();
        await client.deleteSession(params.sessionId);
        return NextResponse.json({ status: 'deleted', sessionId: params.sessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to delete session' }, { status });
    }
}
