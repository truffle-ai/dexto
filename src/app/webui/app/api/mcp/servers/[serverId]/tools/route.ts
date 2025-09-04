import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function GET(req: Request, context: { params: Promise<{ serverId: string }> }) {
    try {
        const { serverId } = await context.params;
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const tools = await client.getMCPServerTools(serverId);
        return NextResponse.json({ tools });
    } catch (err: any) {
        const status = err?.statusCode || (err?.code === 'VALIDATION_ERROR' ? 400 : 500);
        return NextResponse.json(
            { error: err?.message || 'Failed to get MCP server tools' },
            { status }
        );
    }
}
