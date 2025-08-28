import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client';

export async function GET() {
    try {
        const client = getDextoClient();
        const servers = await client.listMCPServers();
        return NextResponse.json({ servers });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to list MCP servers' },
            { status }
        );
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, config } = body || {};
        if (!name || !config) {
            return NextResponse.json({ error: 'name and config are required' }, { status: 400 });
        }
        const client = getDextoClient();
        await client.connectMCPServer(name, config);
        return NextResponse.json({ status: 'connected', name }, { status: 201 });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to connect MCP server' },
            { status }
        );
    }
}
