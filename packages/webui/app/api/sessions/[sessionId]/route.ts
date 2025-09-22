import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await context.params;
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

        const session = await client.getSession(sessionId);
        return NextResponse.json({ session });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to get session') },
            { status }
        );
    }
}

export async function DELETE(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await context.params;
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

        await client.deleteSession(sessionId);
        return NextResponse.json({ status: 'deleted', sessionId });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to delete session') },
            { status }
        );
    }
}
