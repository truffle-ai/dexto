import { NextResponse } from 'next/server';
import { DextoClient } from '@dexto/client-sdk';
import type { LLMConfig } from '@dexto/client-sdk';
import { resolveStatus, resolveMessage } from '@/lib/api-error';
import { LLMSwitchRequestSchema } from '@/lib/validation';

export async function POST(req: Request) {
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

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const result = LLMSwitchRequestSchema.safeParse(body);
        if (!result.success) {
            const message = result.error.errors.map((e) => e.message).join(', ');
            return NextResponse.json({ error: `Invalid request: ${message}` }, { status: 400 });
        }

        const { sessionId, ...configInput } = result.data;
        const configPayload = configInput as Partial<LLMConfig> & { maxTokens?: number };
        const { maxTokens, ...llmConfig } = configPayload;
        const normalizedConfig: Partial<LLMConfig> = { ...llmConfig };
        if (typeof maxTokens === 'number') {
            normalizedConfig.maxOutputTokens = maxTokens;
        }

        const sid = sessionId && sessionId.length > 0 ? sessionId : undefined;
        const newConfig = await client.switchLLM(normalizedConfig, sid);
        return NextResponse.json({ config: newConfig });
    } catch (err: unknown) {
        const status = resolveStatus(err, 500);
        return NextResponse.json(
            { error: resolveMessage(err, 'Failed to switch LLM') },
            { status }
        );
    }
}
