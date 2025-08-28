import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET() {
    try {
        const client = getDextoClient();
        const currentSessionId = await client.getCurrentSession();
        return NextResponse.json({ currentSessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to get current session' },
            { status }
        );
    }
}
