import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk/index.js';

export async function POST(req: Request) {
    try {
        const client = new DextoClient(
            {
                baseUrl: process.env.DEXTO_API_BASE_URL || 'http://localhost:3001',
                ...(process.env.DEXTO_API_KEY ? { apiKey: process.env.DEXTO_API_KEY } : {}),
            },
            { enableWebSocket: false }
        );

        const { message, sessionId, imageData, fileData } = await req.json();

        const response = await client.sendMessage({
            content: message,
            sessionId,
            stream: false, // Force non-streaming for sync endpoint
            imageData,
            fileData,
        });

        return NextResponse.json(response);
    } catch (err: any) {
        const isValidation = err?.name === 'ZodError' || err?.code === 'VALIDATION_ERROR';
        const status = err?.statusCode || (isValidation ? 400 : 500);
        const message = isValidation ? 'Invalid request body' : 'Failed to send message';
        return NextResponse.json({ error: message }, { status });
    }
}
