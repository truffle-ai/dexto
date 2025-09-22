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

        const { message, sessionId, imageData, fileData } = await req.json();

        const response = await client.sendMessage({
            content: message,
            sessionId,
            stream: false, // Force non-streaming for sync endpoint
            imageData,
            fileData,
        });

        return NextResponse.json(response);
    } catch (err: unknown) {
        const anyErr = err as { name?: string; type?: string } | undefined;
        const isValidation = anyErr?.name === 'ZodError' || errorHasCode(err, 'VALIDATION_ERROR');
        const isSyntaxError =
            anyErr?.name === 'SyntaxError' || anyErr?.type === 'entity.parse.failed';

        const baseStatus = resolveStatus(err, 500);
        const isForbidden = errorHasCode(err, 'FORBIDDEN_RUNTIME') || baseStatus === 403;
        const status = isValidation || isSyntaxError ? 400 : isForbidden ? 403 : baseStatus;

        const errorMessage =
            isValidation || isSyntaxError
                ? 'Invalid request body'
                : resolveMessage(err, 'Failed to send message');

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
