import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function POST(req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const { name, config } = await req.json();

        if (!name || !config) {
            return NextResponse.json({ error: 'name and config are required' }, { status: 400 });
        }

        await client.connectMCPServer(name, config);
        return NextResponse.json({ status: 'connected', name });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to connect server' }, { status });
    }
}
