import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { message, content, sessionId, imageData, fileData } = body || {};

        const client = getDextoClient();
        const response = await client.sendMessage({
            content: typeof content === 'string' ? content : message || '',
            ...(sessionId ? { sessionId } : {}),
            ...(imageData ? { imageData } : {}),
            ...(fileData ? { fileData } : {}),
            stream: false,
        });
        return NextResponse.json(response, { status: 200 });
    } catch (err: any) {
        const status = err?.statusCode || 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to send message (sync)' },
            { status }
        );
    }
}
