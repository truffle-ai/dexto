import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';

export async function DELETE(_req: Request, context: { params: Promise<{ serverId: string }> }) {
    try {
        const { serverId } = await context.params;
        if (typeof serverId !== 'string' || serverId.trim().length === 0) {
            return NextResponse.json({ error: 'serverId is required' }, { status: 400 });
        }
        const normalizedServerId = serverId.trim();
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

        await client.disconnectMCPServer(normalizedServerId);
        return NextResponse.json({ status: 'disconnected', serverId: normalizedServerId });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to disconnect MCP server') },
            { status }
        );
    }
}
