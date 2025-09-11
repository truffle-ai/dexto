import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    try {
        const baseUrl =
            process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const url = new URL(req.url);
        const sessionId = url.searchParams.get('sessionId');
        const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const timeoutMs = Number(process.env.DEXTO_HTTP_TIMEOUT_MS) || 15000;
        const res = await fetch(`${baseUrl}/api/config.yaml${params}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout?.(timeoutMs),
            headers: {
                Accept: 'application/x-yaml',
                ...(process.env.DEXTO_API_KEY ? { 'X-API-Key': process.env.DEXTO_API_KEY } : {}),
            },
        });
        const text = await res.text();
        const status = res.status || 200;
        return new NextResponse(text, {
            status,
            headers: { 'Content-Type': 'application/x-yaml' },
        });
    } catch (err: any) {
        const status = 500;
        return NextResponse.json(
            { error: err?.message || 'Failed to fetch config.yaml' },
            { status }
        );
    }
}
