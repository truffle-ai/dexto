import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import { CatalogQuerySchema } from '@/lib/validation';
import type { CatalogQuery } from '@/lib/validation';
import { resolveStatus, resolveMessage } from '@/lib/api-error';

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
        const result = CatalogQuerySchema.safeParse(queryObject);
        if (!result.success) {
            const message = result.error.errors.map((e) => e.message).join(', ');
            return NextResponse.json(
                { error: `Invalid query parameters: ${message}` },
                { status: 400 }
            );
        }

        const { provider, hasKey, router, fileType, defaultOnly, mode } = result.data;

        // Forward validated parameters to the client SDK
        const catalog = await client.getLLMCatalog({
            ...(provider && { provider }),
            ...(typeof hasKey !== 'undefined' && { hasKey: hasKey === 'true' }),
            ...(router && { router: router as 'vercel' | 'in-built' }),
            ...(fileType && { fileType: fileType as 'audio' | 'pdf' | 'image' }),
            ...(typeof defaultOnly !== 'undefined' && { defaultOnly: defaultOnly === 'true' }),
            mode: (mode as 'grouped' | 'flat') ?? 'grouped',
        });

        return NextResponse.json(catalog);
    } catch (error) {
        console.error('Error fetching LLM catalog:', error);
        const status = resolveStatus(error, 500);
        return NextResponse.json(
            { error: resolveMessage(error, 'Failed to fetch LLM catalog') },
            { status }
        );
    }
}
