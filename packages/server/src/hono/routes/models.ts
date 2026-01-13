/**
 * Models Routes
 *
 * API endpoints for listing and managing local/ollama models.
 * These endpoints expose model discovery that CLI does directly via function calls.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { promises as fs } from 'fs';
import {
    getLocalModelById,
    listOllamaModels,
    DEFAULT_OLLAMA_URL,
    checkOllamaStatus,
    logger,
} from '@dexto/core';
import {
    getAllInstalledModels,
    getInstalledModel,
    removeInstalledModel,
} from '@dexto/agent-management';

// ============================================================================
// Schemas
// ============================================================================

const LocalModelSchema = z
    .object({
        id: z.string().describe('Model identifier'),
        displayName: z.string().describe('Human-readable model name'),
        filePath: z.string().describe('Absolute path to the GGUF file'),
        sizeBytes: z.number().describe('File size in bytes'),
        contextLength: z.number().optional().describe('Maximum context length in tokens'),
        source: z
            .enum(['huggingface', 'manual'])
            .optional()
            .describe('Where the model was downloaded from'),
    })
    .describe('An installed local GGUF model');

const OllamaModelSchema = z
    .object({
        name: z.string().describe('Ollama model name (e.g., llama3.2:latest)'),
        size: z.number().optional().describe('Model size in bytes'),
        digest: z.string().optional().describe('Model digest/hash'),
        modifiedAt: z.string().optional().describe('Last modified timestamp'),
    })
    .describe('An Ollama model');

const ValidateFileRequestSchema = z
    .object({
        filePath: z.string().min(1).describe('Absolute path to the GGUF file to validate'),
    })
    .describe('File validation request');

const ValidateFileResponseSchema = z
    .object({
        valid: z.boolean().describe('Whether the file exists and is readable'),
        sizeBytes: z.number().optional().describe('File size in bytes if valid'),
        error: z.string().optional().describe('Error message if invalid'),
    })
    .describe('File validation response');

// ============================================================================
// Route Definitions
// ============================================================================

const listLocalModelsRoute = createRoute({
    method: 'get',
    path: '/models/local',
    summary: 'List Local Models',
    description:
        'Returns all installed local GGUF models from ~/.dexto/models/state.json. ' +
        'These are models downloaded from HuggingFace or manually registered.',
    tags: ['models'],
    responses: {
        200: {
            description: 'List of installed local models',
            content: {
                'application/json': {
                    schema: z.object({
                        models: z
                            .array(LocalModelSchema)
                            .describe('List of installed local models'),
                    }),
                },
            },
        },
    },
});

const listOllamaModelsRoute = createRoute({
    method: 'get',
    path: '/models/ollama',
    summary: 'List Ollama Models',
    description:
        'Returns available models from the local Ollama server. ' +
        'Returns empty list with available=false if Ollama is not running.',
    tags: ['models'],
    request: {
        query: z.object({
            baseURL: z
                .string()
                .url()
                .optional()
                .describe(`Ollama server URL (default: ${DEFAULT_OLLAMA_URL})`),
        }),
    },
    responses: {
        200: {
            description: 'List of Ollama models',
            content: {
                'application/json': {
                    schema: z.object({
                        available: z.boolean().describe('Whether Ollama server is running'),
                        version: z.string().optional().describe('Ollama server version'),
                        models: z
                            .array(OllamaModelSchema)
                            .describe('List of available Ollama models'),
                        error: z
                            .string()
                            .optional()
                            .describe('Error message if Ollama not available'),
                    }),
                },
            },
        },
    },
});

const validateLocalFileRoute = createRoute({
    method: 'post',
    path: '/models/local/validate',
    summary: 'Validate GGUF File',
    description:
        'Validates that a GGUF file exists and is readable. ' +
        'Used by Web UI to validate custom file paths before saving.',
    tags: ['models'],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: ValidateFileRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Validation result',
            content: {
                'application/json': {
                    schema: ValidateFileResponseSchema,
                },
            },
        },
    },
});

const DeleteModelRequestSchema = z
    .object({
        deleteFile: z
            .boolean()
            .default(true)
            .describe('Whether to also delete the GGUF file from disk'),
    })
    .describe('Delete model request options');

const DeleteModelResponseSchema = z
    .object({
        success: z.boolean().describe('Whether the deletion was successful'),
        modelId: z.string().describe('The deleted model ID'),
        fileDeleted: z.boolean().describe('Whether the GGUF file was deleted'),
        error: z.string().optional().describe('Error message if deletion failed'),
    })
    .describe('Delete model response');

const deleteLocalModelRoute = createRoute({
    method: 'delete',
    path: '/models/local/{modelId}',
    summary: 'Delete Installed Model',
    description:
        'Removes an installed local model from state.json. ' +
        'Optionally deletes the GGUF file from disk (default: true).',
    tags: ['models'],
    request: {
        params: z.object({
            modelId: z.string().describe('The model ID to delete'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: DeleteModelRequestSchema,
                },
            },
            required: false,
        },
    },
    responses: {
        200: {
            description: 'Model deleted successfully',
            content: {
                'application/json': {
                    schema: DeleteModelResponseSchema,
                },
            },
        },
        404: {
            description: 'Model not found',
            content: {
                'application/json': {
                    schema: DeleteModelResponseSchema,
                },
            },
        },
    },
});

// ============================================================================
// Router
// ============================================================================

export function createModelsRouter() {
    const app = new OpenAPIHono();

    return app
        .openapi(listLocalModelsRoute, async (ctx) => {
            const installedModels = await getAllInstalledModels();

            const models = installedModels.map((model) => {
                // Get display name from registry if available
                const registryInfo = getLocalModelById(model.id);

                return {
                    id: model.id,
                    displayName: registryInfo?.name || model.id,
                    filePath: model.filePath,
                    sizeBytes: model.sizeBytes,
                    contextLength: registryInfo?.contextLength,
                    source: model.source,
                };
            });

            return ctx.json({ models });
        })
        .openapi(listOllamaModelsRoute, async (ctx) => {
            const { baseURL } = ctx.req.valid('query');
            const ollamaURL = baseURL || DEFAULT_OLLAMA_URL;

            try {
                // Check if Ollama is running
                const status = await checkOllamaStatus(ollamaURL);

                if (!status.running) {
                    return ctx.json({
                        available: false,
                        models: [],
                        error: 'Ollama server is not running',
                    });
                }

                // List available models
                const ollamaModels = await listOllamaModels(ollamaURL);

                return ctx.json({
                    available: true,
                    version: status.version,
                    models: ollamaModels.map((m) => ({
                        name: m.name,
                        size: m.size,
                        digest: m.digest,
                        modifiedAt: m.modifiedAt,
                    })),
                });
            } catch (error) {
                return ctx.json({
                    available: false,
                    models: [],
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Failed to connect to Ollama server',
                });
            }
        })
        .openapi(validateLocalFileRoute, async (ctx) => {
            const { filePath } = ctx.req.valid('json');

            // Security: Basic path validation
            // Prevent path traversal attacks by ensuring absolute path
            if (!filePath.startsWith('/')) {
                return ctx.json({
                    valid: false,
                    error: 'File path must be absolute (start with /)',
                });
            }

            // Validate file extension
            if (!filePath.endsWith('.gguf')) {
                return ctx.json({
                    valid: false,
                    error: 'File must have .gguf extension',
                });
            }

            try {
                const stats = await fs.stat(filePath);

                if (!stats.isFile()) {
                    return ctx.json({
                        valid: false,
                        error: 'Path is not a file',
                    });
                }

                // Check file is readable
                await fs.access(filePath, fs.constants.R_OK);

                return ctx.json({
                    valid: true,
                    sizeBytes: stats.size,
                });
            } catch (error) {
                const nodeError = error as NodeJS.ErrnoException;

                if (nodeError.code === 'ENOENT') {
                    return ctx.json({
                        valid: false,
                        error: 'File not found',
                    });
                }

                if (nodeError.code === 'EACCES') {
                    return ctx.json({
                        valid: false,
                        error: 'File is not readable (permission denied)',
                    });
                }

                return ctx.json({
                    valid: false,
                    error: error instanceof Error ? error.message : 'Failed to access file',
                });
            }
        })
        .openapi(deleteLocalModelRoute, async (ctx) => {
            const { modelId } = ctx.req.valid('param');

            // Get body if provided, default to deleteFile: true
            let deleteFile = true;
            try {
                const body = await ctx.req.json();
                if (body && typeof body.deleteFile === 'boolean') {
                    deleteFile = body.deleteFile;
                }
            } catch {
                // No body or invalid JSON - use default (deleteFile: true)
            }

            // Get the model info first (need filePath for deletion)
            const model = await getInstalledModel(modelId);
            if (!model) {
                return ctx.json(
                    {
                        success: false,
                        modelId,
                        fileDeleted: false,
                        error: `Model '${modelId}' not found`,
                    },
                    404
                );
            }

            const filePath = model.filePath;
            let fileDeleted = false;

            // Delete the GGUF file if requested
            if (deleteFile && filePath) {
                try {
                    await fs.unlink(filePath);
                    fileDeleted = true;
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException;
                    // File already deleted or doesn't exist - that's fine
                    if (nodeError.code === 'ENOENT') {
                        fileDeleted = true; // Consider it deleted
                    } else {
                        // Permission error or other issue - report but continue
                        logger.warn(
                            `Failed to delete GGUF file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
            }

            // Remove from state.json
            const removed = await removeInstalledModel(modelId);
            if (!removed) {
                return ctx.json({
                    success: false,
                    modelId,
                    fileDeleted,
                    error: 'Failed to remove model from state',
                });
            }

            return ctx.json({
                success: true,
                modelId,
                fileDeleted,
            });
        });
}
