import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET(req: Request) {
    try {
        const client = getDextoClient();
        const url = new URL(req.url);
        const sessionId = url.searchParams.get('sessionId') || undefined;
        const config = await client.getCurrentLLMConfig(sessionId);
        return NextResponse.json({ config });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to get LLM config' }, { status });
    }
}
