import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    try {
        const baseUrl = process.env.DEXTO_API_BASE_URL || 'http://localhost:3001';
        const url = new URL(req.url);
        const sessionId = url.searchParams.get('sessionId');
        const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const res = await fetch(`${baseUrl}/api/config.yaml${params}`, { cache: 'no-store' });
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
