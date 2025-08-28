import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { message, content, sessionId, imageData, fileData, stream } = body || {};

        const client = getDextoClient();
        const response = await client.sendMessage({
            content: typeof content === 'string' ? content : message || '',
            ...(sessionId ? { sessionId } : {}),
            ...(imageData ? { imageData } : {}),
            ...(fileData ? { fileData } : {}),
            // Default to true for this endpoint to hit backend /api/message
            stream: stream === undefined ? true : !!stream,
        });
        return NextResponse.json(response, { status: 202 });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json({ error: err?.message || 'Failed to send message' }, { status });
    }
}
