import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage, errorHasCode } from '@/lib/api-error';

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
    } catch (err: unknown) {
        const status = errorHasCode(err, 'VALIDATION_ERROR') ? 400 : resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to send message') },
            { status }
        );
    }
}
