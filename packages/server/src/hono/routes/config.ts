import { Hono } from 'hono';
import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import { stringify as yamlStringify } from 'yaml';
import { sendJson } from '../utils/response.js';
import { parseQuery } from '../utils/validation.js';
import { redactionMiddleware } from '../middleware/redaction.js';

const querySchema = z.object({
    sessionId: z.string().optional(),
    pretty: z.string().optional(),
});

export function createConfigRouter(agent: DextoAgent) {
    const app = new Hono();

    app.use('/config.yaml', redactionMiddleware);

    app.get('/config.yaml', async (ctx) => {
        const { sessionId } = parseQuery(ctx, querySchema);
        const config = agent.getEffectiveConfig(sessionId);

        const maskedConfig = {
            ...config,
            llm: {
                ...config.llm,
                apiKey: config.llm.apiKey ? '[REDACTED]' : undefined,
            },
            mcpServers: redactMcpServersConfig(config.mcpServers),
        };

        const yaml = yamlStringify(maskedConfig);
        ctx.header('Content-Type', 'application/x-yaml');
        return ctx.body(yaml);
    });

    app.get('/greeting', (ctx) => {
        const { sessionId } = parseQuery(ctx, querySchema.pick({ sessionId: true }));
        const config = agent.getEffectiveConfig(sessionId);
        return sendJson(ctx, { greeting: config.greeting });
    });

    return app;
}

function redactEnvValue(value: unknown) {
    if (typeof value === 'string' && value.length > 0) {
        return '[REDACTED]';
    }
    return value;
}

function redactServerEnvVars(serverConfig: any) {
    if (!serverConfig?.env) {
        return serverConfig;
    }

    const redactedEnv: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(serverConfig.env)) {
        redactedEnv[key] = redactEnvValue(value);
    }

    return {
        ...serverConfig,
        env: redactedEnv,
    };
}

function redactMcpServersConfig(mcpServers: any) {
    if (!mcpServers) {
        return {};
    }

    const redacted: Record<string, unknown> = {};
    for (const [name, serverConfig] of Object.entries(mcpServers)) {
        redacted[name] = redactServerEnvVars(serverConfig);
    }

    return redacted;
}
