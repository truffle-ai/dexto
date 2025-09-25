import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
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
    const app = new OpenAPIHono();

    app.use('/config.yaml', redactionMiddleware);

    const yamlRoute = createRoute({
        method: 'get',
        path: '/config.yaml',
        tags: ['config'],
        request: { query: querySchema },
        responses: {
            200: {
                description: 'Effective agent config (YAML) with sensitive values redacted',
                content: { 'application/x-yaml': { schema: z.string() } },
            },
        },
    });
    app.openapi(yamlRoute, async (ctx) => {
        const { sessionId } = parseQuery(ctx, querySchema);
        const cfg = agent.getEffectiveConfig(sessionId);

        const maskedConfig = {
            ...cfg,
            llm: {
                ...cfg.llm,
                apiKey: cfg.llm.apiKey ? '[REDACTED]' : undefined,
            },
            mcpServers: redactMcpServersConfig(cfg.mcpServers),
        };

        const yaml = yamlStringify(maskedConfig);
        ctx.header('Content-Type', 'application/x-yaml');
        return ctx.body(yaml);
    });

    const greetingRoute = createRoute({
        method: 'get',
        path: '/greeting',
        tags: ['config'],
        request: { query: querySchema.pick({ sessionId: true }) },
        responses: {
            200: { description: 'Greeting', content: { 'application/json': { schema: z.any() } } },
        },
    });
    app.openapi(greetingRoute, (ctx) => {
        const { sessionId } = parseQuery(ctx, querySchema.pick({ sessionId: true }));
        const cfg = agent.getEffectiveConfig(sessionId);
        return sendJson(ctx, { greeting: cfg.greeting });
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
