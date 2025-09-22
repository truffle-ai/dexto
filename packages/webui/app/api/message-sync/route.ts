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

        const { message, sessionId, imageData, fileData } = result.data;

        const normalizedSessionId = sessionId && sessionId.length > 0 ? sessionId : undefined;
        const normalizedImageData = imageData
            ? { image: imageData.base64, mimeType: imageData.mimeType }
            : undefined;
        const normalizedFileData = fileData
            ? { data: fileData.base64, mimeType: fileData.mimeType, filename: fileData.filename }
            : undefined;

        const response = await client.sendMessage({
            message: message,
            sessionId: normalizedSessionId,
            stream: false, // Force non-streaming for sync endpoint
            imageData: normalizedImageData,
            fileData: normalizedFileData,
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
