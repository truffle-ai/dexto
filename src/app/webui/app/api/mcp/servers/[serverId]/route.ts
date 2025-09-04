import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function DELETE(_req: Request, context: { params: Promise<{ serverId: string }> }) {
    try {
        const { serverId } = await context.params;
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        await client.disconnectMCPServer(serverId);
        return NextResponse.json({ status: 'disconnected', serverId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to disconnect MCP server' },
            { status }
        );
    }
}
