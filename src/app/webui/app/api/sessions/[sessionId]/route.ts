import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await params;
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const session = await client.getSession(sessionId);
        return NextResponse.json({ session });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to get session' }, { status });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await params;
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        await client.deleteSession(sessionId);
        return NextResponse.json({ status: 'deleted', sessionId });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to delete session' }, { status });
    }
}
