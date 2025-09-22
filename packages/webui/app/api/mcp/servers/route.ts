import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';
import { McpServerRequestSchema } from '@/lib/validation';

export async function GET(_req: Request) {
    try {
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

        const servers = await client.listMCPServers();
        return NextResponse.json({ servers });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to get MCP servers') },
            { status }
        );
    }
}

export async function POST(req: Request) {
    try {
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

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const result = McpServerRequestSchema.safeParse(body);
        if (!result.success) {
            const message = result.error.errors.map((e) => e.message).join(', ');
            return NextResponse.json({ error: `Invalid request: ${message}` }, { status: 400 });
        }

        const { name, config } = result.data;
        const trimmedName = name.trim();
        await client.connectMCPServer(trimmedName, config as Record<string, unknown>);
        return NextResponse.json({ status: 'connected', name: trimmedName });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to connect MCP server') },
            { status }
        );
    }
}
