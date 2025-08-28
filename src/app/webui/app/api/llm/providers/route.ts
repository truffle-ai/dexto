import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET() {
    try {
        const client = getDextoClient();
        const providers = await client.getLLMProviders();
        return NextResponse.json({ providers });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to get LLM providers' },
            { status }
        );
    }
}
