import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { CatalogQuerySchema, validateQuery } from '@/lib/validation';
import type { CatalogQuery } from '@/lib/validation';

export async function GET(request: Request) {
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
        const url = new URL(request.url);

        // Convert URLSearchParams to plain object for validation
        const queryObject = Object.fromEntries(url.searchParams.entries());

        // Validate query parameters
        const validation = validateQuery<CatalogQuery>(CatalogQuerySchema, queryObject);
        if (!validation.success) {
            return NextResponse.json(validation.response, { status: 400 });
        }

        const { provider, hasKey, router, fileType, defaultOnly, mode } = validation.data;

        // Forward validated parameters to the client SDK
        const catalog = await client.getLLMCatalog({
            ...(provider && { provider }),
            ...(typeof hasKey !== 'undefined' && { hasKey: hasKey === 'true' }),
            ...(router && { router: router as 'vercel' | 'in-built' }),
            ...(fileType && { fileType: fileType as 'audio' | 'pdf' | 'image' | 'text' }),
            ...(typeof defaultOnly !== 'undefined' && { defaultOnly: defaultOnly === 'true' }),
            mode: (mode as 'grouped' | 'flat') ?? 'grouped',
        });

        return NextResponse.json(catalog);
    } catch (error) {
        console.error('Error fetching LLM catalog:', error);
        return NextResponse.json({ error: 'Failed to fetch LLM catalog' }, { status: 500 });
    }
}
