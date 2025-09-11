import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';

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

        const { message, sessionId, stream, imageData, fileData } = await req.json();

        const response = await client.sendMessage({
            content: message,
            sessionId,
            stream,
            imageData,
            fileData,
        });

        return NextResponse.json(response);
    } catch (err: any) {
        const status = err?.statusCode || (err?.code === 'VALIDATION_ERROR' ? 400 : 500);
        return NextResponse.json({ error: err?.message || 'Failed to send message' }, { status });
    }
}
