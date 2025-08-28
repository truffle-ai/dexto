import { NextResponse } from 'next/server';
import { getDextoClient } from '../../../../_client';

export async function GET(_req: Request, { params }: any) {
    try {
        const client = getDextoClient();
        const { serverId } = params || {};
        const tools = await client.getMCPServerTools(serverId);
        return NextResponse.json({ tools });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to list MCP tools' }, { status });
    }
}
