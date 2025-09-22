import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage, errorHasCode } from '@/lib/api-error';
import { MessageRequestSchema } from '@/lib/validation';

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

        const result = MessageRequestSchema.safeParse(body);
        if (!result.success) {
            const message = result.error.errors.map((e) => e.message).join(', ');
            return NextResponse.json({ error: `Invalid request: ${message}` }, { status: 400 });
        }

        const { message, sessionId, stream, imageData, fileData } = result.data;
        if (stream === true) {
            return NextResponse.json(
                {
                    error: 'Streaming is not supported on this endpoint. Use /api/message-sync or WebSocket mode.',
                },
                { status: 400 }
            );
        }

        const normalizedImageData = imageData
            ? { image: imageData.base64, mimeType: imageData.mimeType }
            : undefined;
        const normalizedFileData = fileData
            ? { data: fileData.base64, mimeType: fileData.mimeType, filename: fileData.filename }
            : undefined;
        const normalizedSessionId = sessionId && sessionId.length > 0 ? sessionId : undefined;

        const response = await client.sendMessage({
            message: message,
            sessionId: normalizedSessionId,
            stream: false,
            imageData: normalizedImageData,
            fileData: normalizedFileData,
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
