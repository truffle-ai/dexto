import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';
import { SessionCreateRequestSchema } from '@/lib/validation';

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

        const sessions = await client.listSessions();
        return NextResponse.json({ sessions });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to list sessions') },
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

        const result = SessionCreateRequestSchema.safeParse(body);
        if (!result.success) {
            const message = result.error.errors.map((e) => e.message).join(', ');
            return NextResponse.json({ error: `Invalid request: ${message}` }, { status: 400 });
        }

        const { sessionId } = result.data;
        const normalizedSessionId =
            sessionId && sessionId.trim().length > 0 ? sessionId.trim() : undefined;
        const session = await client.createSession(normalizedSessionId);
        return NextResponse.json({ session });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to create session') },
            { status }
        );
    }
}
