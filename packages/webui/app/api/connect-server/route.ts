import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';

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

        // parse and validate JSON body
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { name, config } = (body ?? {}) as Record<string, unknown>;

        if (typeof name !== 'string' || name.length === 0) {
            return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
        }

        if (typeof config !== 'object' || config === null || Array.isArray(config)) {
            return NextResponse.json({ error: 'config must be an object' }, { status: 400 });
        }

        // now that types are safe, connect
        await client.connectMCPServer(name, config as Record<string, unknown>);

        return NextResponse.json({ status: 'connected', name });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to connect server') },
            { status }
        );
    }
}
