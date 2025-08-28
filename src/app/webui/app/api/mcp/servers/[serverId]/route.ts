import { NextResponse } from 'next/server';
import { getDextoClient } from '../../../_client';

export async function DELETE(_req: Request, { params }: any) {
    try {
        const client = getDextoClient();
        const { serverId } = params || {};
        await client.disconnectMCPServer(serverId);
        return NextResponse.json({ status: 'disconnected', id: serverId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to disconnect MCP server' },
            { status }
        );
    }
}
