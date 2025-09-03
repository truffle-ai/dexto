import { NextResponse } from 'next/server';
import { getDextoClient } from '../_client.js';
import { GreetingQuerySchema, validateQuery } from '@/lib/validation';

export async function GET(request: Request) {
    try {
        const client = getDextoClient();
        const url = new URL(request.url);

        // Convert URLSearchParams to plain object for validation
        const queryObject = Object.fromEntries(url.searchParams.entries());

        // Validate query parameters
        const validation = validateQuery(GreetingQuerySchema, queryObject);
        if (!validation.success) {
            return NextResponse.json(validation.response, { status: 400 });
        }

        const { sessionId } = validation.data;
        const greeting = await client.getGreeting(sessionId);

        return NextResponse.json({ greeting });
    } catch (error) {
        console.error('Error fetching greeting:', error);
        return NextResponse.json({ error: 'Failed to fetch greeting' }, { status: 500 });
    }
}
