import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { PromptError } from '@dexto/core';

const CustomPromptRequestSchema = z
    .object({
        name: z.string().min(1, 'Prompt name is required'),
        title: z.string().optional(),
        description: z.string().optional(),
        content: z.string().min(1, 'Prompt content is required'),
        arguments: z
            .array(
                z
                    .object({
                        name: z.string().min(1, 'Argument name is required'),
                        description: z.string().optional(),
                        required: z.boolean().optional(),
                    })
                    .strict()
            )
            .optional(),
        resource: z
            .object({
                base64: z.string().min(1, 'Resource data is required'),
                mimeType: z.string().min(1, 'Resource MIME type is required'),
                filename: z.string().optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

const PromptNameParamSchema = z.object({
    name: z.string().min(1, 'Prompt name is required'),
});

const ResolvePromptQuerySchema = z.object({
    context: z.string().optional(),
    args: z.string().optional(),
});

export function createPromptsRouter(getAgent: () => DextoAgent) {
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/prompts',
        tags: ['prompts'],
        responses: {
            200: {
                description: 'List all prompts',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(listRoute, async (ctx) => {
        const agent = getAgent();
        const prompts = await agent.listPrompts();
        const list = Object.values(prompts);
        return ctx.json({ prompts: list });
    });

    const createCustomRoute = createRoute({
        method: 'post',
        path: '/prompts/custom',
        tags: ['prompts'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: CustomPromptRequestSchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Custom prompt created',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(createCustomRoute, async (ctx) => {
        const agent = getAgent();
        const payload = ctx.req.valid('json');
        const promptArguments = payload.arguments
            ?.map((arg) => ({
                name: arg.name,
                ...(arg.description ? { description: arg.description } : {}),
                ...(typeof arg.required === 'boolean' ? { required: arg.required } : {}),
            }))
            .filter(Boolean);

        const createPayload = {
            name: payload.name,
            content: payload.content,
            ...(payload.title ? { title: payload.title } : {}),
            ...(payload.description ? { description: payload.description } : {}),
            ...(promptArguments && promptArguments.length > 0
                ? { arguments: promptArguments }
                : {}),
            ...(payload.resource
                ? {
                      resource: {
                          base64: payload.resource.base64,
                          mimeType: payload.resource.mimeType,
                          ...(payload.resource.filename
                              ? { filename: payload.resource.filename }
                              : {}),
                      },
                  }
                : {}),
        };
        const prompt = await agent.createCustomPrompt(createPayload);
        return ctx.json({ prompt }, 201);
    });

    const deleteCustomRoute = createRoute({
        method: 'delete',
        path: '/prompts/custom/{name}',
        tags: ['prompts'],
        request: {
            params: z.object({
                name: z.string().min(1, 'Prompt name is required'),
            }),
        },
        responses: {
            204: { description: 'Prompt deleted' },
        },
    });
    app.openapi(deleteCustomRoute, async (ctx) => {
        const agent = getAgent();
        const { name } = ctx.req.valid('param');
        // Decode URI component if needed
        const decodedName = decodeURIComponent(name);
        await agent.deleteCustomPrompt(decodedName);
        return ctx.body(null, 204);
    });

    const getPromptRoute = createRoute({
        method: 'get',
        path: '/prompts/{name}',
        tags: ['prompts'],
        request: {
            params: PromptNameParamSchema,
        },
        responses: {
            200: {
                description: 'Prompt definition',
                content: { 'application/json': { schema: z.any() } },
            },
            404: { description: 'Prompt not found' },
        },
    });
    app.openapi(getPromptRoute, async (ctx) => {
        const agent = getAgent();
        const { name } = ctx.req.valid('param');
        const definition = await agent.getPromptDefinition(name);
        if (!definition) throw PromptError.notFound(name);
        return ctx.json({ definition });
    });

    const resolvePromptRoute = createRoute({
        method: 'get',
        path: '/prompts/{name}/resolve',
        tags: ['prompts'],
        request: {
            params: PromptNameParamSchema,
            query: ResolvePromptQuerySchema,
        },
        responses: {
            200: {
                description: 'Resolved prompt content',
                content: { 'application/json': { schema: z.any() } },
            },
            404: { description: 'Prompt not found' },
        },
    });
    app.openapi(resolvePromptRoute, async (ctx) => {
        const agent = getAgent();
        const { name } = ctx.req.valid('param');
        const { context, args: argsString } = ctx.req.valid('query');

        // Optional structured args in `args` query param as JSON
        let parsedArgs: Record<string, unknown> | undefined;
        if (argsString) {
            try {
                const parsed = JSON.parse(argsString);
                if (parsed && typeof parsed === 'object') {
                    parsedArgs = parsed as Record<string, unknown>;
                }
            } catch {
                // Ignore malformed args JSON; continue with whatever we have
            }
        }

        // Build options object with only defined values
        const options: {
            context?: string;
            args?: Record<string, unknown>;
        } = {};
        if (context !== undefined) options.context = context;
        if (parsedArgs !== undefined) options.args = parsedArgs;

        // Use DextoAgent's resolvePrompt method
        const result = await agent.resolvePrompt(name, options);
        return ctx.json({ result });
    });

    return app;
}
