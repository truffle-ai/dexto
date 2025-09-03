import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client.js';

export async function GET(request: Request) {
    try {
        const client = getDextoClient();
        const url = new URL(request.url);
        const sessionId = url.searchParams.get('sessionId') || undefined;

        const greeting = await client.getGreeting(sessionId);

        return NextResponse.json({ greeting });
    } catch (error) {
        console.error('Error fetching greeting:', error);
        return NextResponse.json({ error: 'Failed to fetch greeting' }, { status: 500 });
    }
}
