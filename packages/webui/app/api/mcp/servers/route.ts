import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';

export async function GET(_req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl:
                    process.env.API_URL ||
                    process.env.NEXT_PUBLIC_API_URL ||
                    'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const servers = await client.listMCPServers();
        return NextResponse.json({ servers });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to get MCP servers' },
            { status }
        );
    }
}

export async function POST(req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl:
                    process.env.API_URL ||
                    process.env.NEXT_PUBLIC_API_URL ||
                    'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const { name, config } = await req.json();
        if (typeof name !== 'string' || !name.trim() || config == null) {
            return NextResponse.json({ error: 'Missing or invalid name/config' }, { status: 400 });
        }
        await client.connectMCPServer(name, config);
        return NextResponse.json({ status: 'connected', name });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to connect MCP server' },
            { status }
        );
    }
}
