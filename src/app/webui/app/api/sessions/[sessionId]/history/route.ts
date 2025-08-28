import { NextResponse } from 'next/server';
import { getDextoClient } from '../../../_client';

export async function GET(_req: Request, { params }: any) {
    try {
        const client = getDextoClient();
        const history = await client.getSessionHistory(params.sessionId);
        return NextResponse.json({ history });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to get session history' },
            { status }
        );
    }
}
