import { NextResponse } from 'next/server';
import { DextoClient } from '@sdk';

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
        const isSyntaxError = err?.name === 'SyntaxError' || err?.type === 'entity.parse.failed';
        const isForbidden = err?.code === 'FORBIDDEN_RUNTIME' || err?.statusCode === 403;
        const status =
            err?.statusCode || (isValidation || isSyntaxError ? 400 : isForbidden ? 403 : 500);
        const errorMessage =
            isValidation || isSyntaxError ? 'Invalid request body' : 'Failed to send message';
        return NextResponse.json({ error: errorMessage }, { status });
    }
}
