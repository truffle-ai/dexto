import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function POST(
    req: Request,
    context: { params: Promise<{ serverId: string; toolName: string }> }
) {
    try {
        const { serverId, toolName } = await context.params;

        // Validate route parameters
        if (!serverId || !toolName) {
            return NextResponse.json(
                { error: 'serverId and toolName are required' },
                { status: 400 }
            );
        }

        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        // Validate and parse JSON body
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const result = await client.executeMCPTool(serverId, toolName, body);
        return NextResponse.json({ success: true, data: result });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to execute MCP tool' },
            { status }
        );
    }
}
