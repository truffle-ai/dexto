import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk/index.js';

export async function GET(_req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

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
