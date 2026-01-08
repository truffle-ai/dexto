import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import { PromptError } from '@dexto/core';
import { PromptInfoSchema, PromptDefinitionSchema } from '../schemas/responses.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const CustomPromptRequestSchema = z
    .object({
        name: z
            .string()
            .min(1, 'Prompt name is required')
            .describe('Unique name for the custom prompt'),
        title: z.string().optional().describe('Display title for the prompt'),
        description: z.string().optional().describe('Description of what the prompt does'),
        content: z
            .string()
            .min(1, 'Prompt content is required')
            .describe('The prompt content text (can include {{argumentName}} placeholders)'),
        arguments: z
            .array(
                z
                    .object({
                        name: z
                            .string()
                            .min(1, 'Argument name is required')
                            .describe('Argument name'),
                        description: z.string().optional().describe('Argument description'),
                        required: z
                            .boolean()
                            .optional()
                            .describe('Whether the argument is required'),
                    })
                    .strict()
            )
            .optional()
            .describe('Array of argument definitions'),
        resource: z
            .object({
                data: z
                    .string()
                    .min(1, 'Resource data is required')
                    .describe('Base64-encoded resource data'),
                mimeType: z
                    .string()
                    .min(1, 'Resource MIME type is required')
                    .describe('MIME type of the resource (e.g., text/plain, application/pdf)'),
                filename: z.string().optional().describe('Resource filename'),
            })
            .strict()
            .optional()
            .describe('Attach a resource to this prompt'),
    })
    .strict()
    .describe('Request body for creating a custom prompt with optional resource attachment');

const PromptNameParamSchema = z
    .object({
        name: z.string().min(1, 'Prompt name is required').describe('The prompt name'),
    })
    .describe('Path parameters for prompt endpoints');

const ResolvePromptQuerySchema = z
    .object({
        context: z.string().optional().describe('Additional context for prompt resolution'),
        args: z
            .string()
            .optional()
            .describe('Arguments to substitute in the prompt template (pass as a JSON string)'),
    })
    .describe('Query parameters for resolving prompt templates');

export function createPromptsRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    const listRoute = createRoute({
        method: 'get',
        path: '/prompts',
        summary: 'List Prompts',
        description: 'Retrieves all available prompts, including both built-in and custom prompts',
        tags: ['prompts'],
        responses: {
            200: {
                description: 'List all prompts',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                prompts: z
                                    .array(PromptInfoSchema)
                                    .describe('Array of available prompts'),
                            })
                            .strict()
                            .describe('Prompts list response'),
                    },
                },
            },
        },
    });

    const createCustomRoute = createRoute({
        method: 'post',
        path: '/prompts/custom',
        summary: 'Create Custom Prompt',
        description:
            'Creates a new custom prompt with optional resource attachment. Maximum request size: 10MB',
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
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                prompt: PromptInfoSchema.describe('Created prompt information'),
                            })
                            .strict()
                            .describe('Create prompt response'),
                    },
                },
            },
        },
    });

    const deleteCustomRoute = createRoute({
        method: 'delete',
        path: '/prompts/custom/{name}',
        summary: 'Delete Custom Prompt',
        description: 'Permanently deletes a custom prompt. Built-in prompts cannot be deleted',
        tags: ['prompts'],
        request: {
            params: z.object({
                name: z.string().min(1, 'Prompt name is required').describe('The prompt name'),
            }),
        },
        responses: {
            204: { description: 'Prompt deleted' },
        },
    });

    const getPromptRoute = createRoute({
        method: 'get',
        path: '/prompts/{name}',
        summary: 'Get Prompt Definition',
        description: 'Fetches the definition for a specific prompt',
        tags: ['prompts'],
        request: {
            params: PromptNameParamSchema,
        },
        responses: {
            200: {
                description: 'Prompt definition',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                definition: PromptDefinitionSchema.describe('Prompt definition'),
                            })
                            .strict()
                            .describe('Get prompt definition response'),
                    },
                },
            },
            404: { description: 'Prompt not found' },
        },
    });

    const resolvePromptRoute = createRoute({
        method: 'get',
        path: '/prompts/{name}/resolve',
        summary: 'Resolve Prompt',
        description:
            'Resolves a prompt template with provided arguments and returns the final text with resources',
        tags: ['prompts'],
        request: {
            params: PromptNameParamSchema,
            query: ResolvePromptQuerySchema,
        },
        responses: {
            200: {
                description: 'Resolved prompt content',
                content: {
                    'application/json': {
                        schema: z
                            .object({
                                text: z.string().describe('Resolved prompt text'),
                                resources: z
                                    .array(z.string())
                                    .describe('Array of resource identifiers'),
                            })
                            .strict()
                            .describe('Resolve prompt response'),
                    },
                },
            },
            404: { description: 'Prompt not found' },
        },
    });

    return app
        .openapi(listRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const prompts = await agent.listPrompts();
            const list = Object.values(prompts);
            return ctx.json({ prompts: list });
        })
        .openapi(createCustomRoute, async (ctx) => {
            const agent = await getAgent(ctx);
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
                              data: payload.resource.data,
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
        })
        .openapi(deleteCustomRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { name } = ctx.req.valid('param');
            // Hono automatically decodes path parameters, no manual decode needed
            await agent.deleteCustomPrompt(name);
            return ctx.body(null, 204);
        })
        .openapi(getPromptRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { name } = ctx.req.valid('param');
            const definition = await agent.getPromptDefinition(name);
            if (!definition) throw PromptError.notFound(name);
            return ctx.json({ definition });
        })
        .openapi(resolvePromptRoute, async (ctx) => {
            const agent = await getAgent(ctx);
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
            return ctx.json({ text: result.text, resources: result.resources });
        });
}
