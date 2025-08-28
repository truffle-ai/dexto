import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client';

// Legacy alias used by UI to connect a server
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, config } = body || {};
        if (!name || !config) {
            return NextResponse.json({ error: 'name and config are required' }, { status: 400 });
        }
        const client = getDextoClient();
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
