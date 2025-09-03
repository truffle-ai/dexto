import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client.js';

export async function GET(request: Request) {
    try {
        const client = getDextoClient();
        const url = new URL(request.url);
        const searchParams = url.searchParams;

        // Forward all query parameters to the client SDK
        const catalog = await client.getLLMCatalog({
            provider: searchParams.get('provider') || undefined,
            hasKey:
                searchParams.get('hasKey') === 'true'
                    ? true
                    : searchParams.get('hasKey') === 'false'
                      ? false
                      : undefined,
            router: (searchParams.get('router') as any) || undefined,
            fileType: (searchParams.get('fileType') as any) || undefined,
            defaultOnly: searchParams.get('defaultOnly') === 'true',
            mode: (searchParams.get('mode') as 'grouped' | 'flat') || 'grouped',
        });

        return NextResponse.json(catalog);
    } catch (error) {
        console.error('Error fetching LLM catalog:', error);
        return NextResponse.json({ error: 'Failed to fetch LLM catalog' }, { status: 500 });
    }
}
