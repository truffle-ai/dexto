import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage, errorHasCode } from '@/lib/api-error';

export async function GET(req: Request, context: { params: Promise<{ serverId: string }> }) {
    try {
        const { serverId } = await context.params;
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

        const tools = await client.getMCPServerTools(serverId);
        return NextResponse.json({ tools });
    } catch (err: unknown) {
        const status = errorHasCode(err, 'VALIDATION_ERROR') ? 400 : resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to get MCP server tools') },
            { status }
        );
    }
}
