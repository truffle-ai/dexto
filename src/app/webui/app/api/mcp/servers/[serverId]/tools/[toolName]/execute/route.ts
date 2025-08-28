import { NextResponse } from 'next/server';
import { getDextoClient } from '../../../../../../_client';

export async function POST(req: Request, { params }: any) {
    try {
        const body = await req.json().catch(() => ({}));
        const { serverId, toolName } = params || {};
        const client = getDextoClient();
        const data = await client.executeMCPTool(serverId, toolName, body);
        return NextResponse.json({ success: true, data });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to execute MCP tool' },
            { status }
        );
    }
}
