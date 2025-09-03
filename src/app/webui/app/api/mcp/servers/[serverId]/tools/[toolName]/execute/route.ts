import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ serverId: string; toolName: string }> }
) {
    try {
        const { serverId, toolName } = await params;
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const { args } = await req.json();
        const result = await client.executeMCPTool(serverId, toolName, args);
        return NextResponse.json({ success: true, data: result });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to execute MCP tool' },
            { status }
        );
    }
}
