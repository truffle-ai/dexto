import { NextResponse } from 'next/server';
import { getDextoClient } from '../../_client.js';
import { CatalogQuerySchema, validateQuery } from '@/lib/validation';

export async function GET(request: Request) {
    try {
        const client = getDextoClient();
        const url = new URL(request.url);

        // Convert URLSearchParams to plain object for validation
        const queryObject = Object.fromEntries(url.searchParams.entries());

        // Validate query parameters
        const validation = validateQuery(CatalogQuerySchema, queryObject);
        if (!validation.success) {
            return NextResponse.json(validation.response, { status: 400 });
        }

        const { provider, hasKey, router, fileType, defaultOnly, mode } = validation.data;

        // Forward validated parameters to the client SDK
        const catalog = await client.getLLMCatalog({
            provider,
            hasKey: hasKey === 'true' ? true : hasKey === 'false' ? false : undefined,
            router: router as any,
            fileType: fileType as any,
            defaultOnly: defaultOnly === 'true',
            mode: (mode as 'grouped' | 'flat') || 'grouped',
        });

        return NextResponse.json(catalog);
    } catch (error) {
        console.error('Error fetching LLM catalog:', error);
        return NextResponse.json({ error: 'Failed to fetch LLM catalog' }, { status: 500 });
    }
}
