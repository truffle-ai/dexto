import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { sessionId, ...llmConfig } = body || {};
        const client = getDextoClient();
        const config = await client.switchLLM(llmConfig, sessionId);
        return NextResponse.json({ config, sessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to switch LLM' }, { status });
    }
}
