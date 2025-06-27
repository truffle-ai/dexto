import {
    isValidProvider,
    isValidProviderModel,
    isValidRouter,
    getSupportedModels,
    getSupportedRoutersForProvider,
    isRouterSupportedForProvider,
    supportsBaseURL,
    getProviderFromModel,
    getDefaultModelForProvider,
    getEffectiveMaxInputTokens,
} from '../ai/llm/registry.js';
import type {
    ValidatedLLMConfig,
    ValidatedMcpServerConfig,
    LLMConfig,
    McpServerConfig,
} from './schemas.js';
import { LLMConfigSchema, McpServerConfigSchema } from './schemas.js';
import type { AgentStateManager } from './agent-state-manager.js';
import { resolveApiKeyForProvider } from '../utils/api-key-resolver.js';
import { logger } from '../logger/index.js';
import { ZodError } from 'zod';

/**
 * Types of validation errors that can occur
 */
export type ValidationErrorType =
    | 'missing_api_key'
    | 'invalid_model'
    | 'invalid_provider'
    | 'incompatible_model_provider'
    | 'unsupported_router'
    | 'invalid_base_url'
    | 'invalid_max_tokens'
    | 'schema_validation'
    | 'general';

/**
 * Structured validation error with context
 */
export interface ValidationError {
    type: ValidationErrorType;
    message: string;
    field?: string;
    provider?: string;
    model?: string;
    router?: string;
    suggestedAction?: string;
}

/**
 * Standard result type for validation operations
 */
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: string[];
    config?: LLMConfig; // Optional validated config for buildLLMConfig
}

/**
 * Result of LLM configuration validation with the validated config
 */
export interface LLMConfigResult extends ValidationResult {
    config: ValidatedLLMConfig;
}

/**
 * Core validation for LLM configuration parameters.
 * Used by all other LLM validation functions.
 */
function validateLLMCore(config: {
    provider?: string;
    model?: string;
    router?: string;
    baseURL?: string;
}): ValidationError[] {
    const errors: ValidationError[] = [];
    const { provider, model, router, baseURL } = config;

    // Validate provider
    if (provider && !isValidProvider(provider)) {
        errors.push({
            type: 'invalid_provider',
            message: `Unknown provider: ${provider}`,
            provider,
        });
        return errors; // Return early if provider doesn't exist
    }

    // Validate router
    if (router && !isValidRouter(router)) {
        errors.push({
            type: 'unsupported_router',
            message: 'Router must be either "vercel" or "in-built"',
            router,
        });
    }

    // Validate provider/model combination if both provided
    if (provider && model && !isValidProviderModel(provider, model)) {
        const supportedModels = getSupportedModels(provider);
        errors.push({
            type: 'incompatible_model_provider',
            message: `Model '${model}' is not supported for provider '${provider}'. Supported models: ${supportedModels.join(', ')}`,
            provider,
            model,
        });
    }

    // Validate provider/router combination if both provided
    if (provider && router && !isRouterSupportedForProvider(provider, router)) {
        const supportedRouters = getSupportedRoutersForProvider(provider);
        errors.push({
            type: 'unsupported_router',
            message: `Provider '${provider}' does not support '${router}' router. Supported routers: ${supportedRouters.join(', ')}`,
            provider,
            router,
        });
    }

    // Validate baseURL usage
    if (baseURL && provider && !supportsBaseURL(provider)) {
        errors.push({
            type: 'invalid_base_url',
            message: `Custom baseURL is not supported for ${provider} provider`,
            provider,
        });
    }

    return errors;
}

/**
 * Validates an LLM switch request.
 */
export function validateLLMSwitchRequest(request: {
    provider?: string;
    model?: string;
    router?: string;
    baseURL?: string;
}): ValidationError[] {
    const { provider, model } = request;

    // Check required fields
    if (!provider || !model) {
        return [
            {
                type: 'general',
                message: 'Provider and model are required',
            },
        ];
    }

    return validateLLMCore(request);
}

/**
 * Builds a complete LLM configuration from partial updates, handling all the complex
 * logic for provider inference, API key resolution, compatibility checks, and validation.
 */
export async function buildValidatedLLMConfig(
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    stateManager: AgentStateManager,
    sessionId?: string
): Promise<{
    config: ValidatedLLMConfig;
    configWarnings: string[];
    isValid: boolean;
    errors: ValidationError[];
}> {
    const result = await buildLLMConfig(updates, currentConfig);

    if (!result.isValid) {
        // Parse currentConfig through schema to get validated type
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return {
            config: validatedCurrentConfig,
            configWarnings: result.warnings,
            isValid: false,
            errors: result.errors,
        };
    }

    // Update state manager with the validated config
    const stateValidation = stateManager.updateLLM(result.config, sessionId);
    if (!stateValidation.isValid) {
        // Parse currentConfig through schema to get validated type
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return {
            config: validatedCurrentConfig,
            configWarnings: [...result.warnings, ...stateValidation.warnings],
            isValid: false,
            errors: stateValidation.errors,
        };
    }

    return {
        config: result.config,
        configWarnings: [...result.warnings, ...stateValidation.warnings],
        isValid: true,
        errors: [],
    };
}

/**
 * Helper function to convert ValidationError array to string array for backward compatibility
 */
export function validationErrorsToStrings(errors: ValidationError[]): string[] {
    return errors.map((error) => error.message);
}

/**
 * Core function that builds and validates an LLM configuration from partial updates.
 * Handles provider inference, model compatibility, router selection, and API key resolution.
 */
export async function buildLLMConfig(
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig
): Promise<LLMConfigResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Step 1: Determine model
    const model = resolveModel(updates, currentConfig, errors);
    if (errors.length > 0) {
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    // Step 2: Determine provider
    const provider = resolveProvider(updates, currentConfig, model, errors, warnings);
    if (errors.length > 0) {
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    // Step 3: Validate model/provider compatibility and fix if needed
    const { finalModel, finalProvider } = resolveModelProviderCompatibility(
        model,
        provider,
        updates,
        currentConfig,
        errors,
        warnings
    );
    if (errors.length > 0) {
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    // Step 4: Determine router
    const router = resolveRouter(updates, currentConfig, finalProvider, errors, warnings);
    if (errors.length > 0) {
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    // Step 5: Determine API key
    const apiKey = await resolveApiKey(updates, currentConfig, finalProvider, errors, warnings);
    if (errors.length > 0) {
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    // Step 6: Build remaining fields
    const config = buildFinalConfig(
        { provider: finalProvider, model: finalModel, router, apiKey },
        updates,
        currentConfig,
        errors,
        warnings
    );
    if (errors.length > 0) {
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    // Step 7: Final schema validation
    const schemaValidation = LLMConfigSchema.safeParse(config);
    if (!schemaValidation.success) {
        const schemaErrors = schemaValidation.error.errors.map((err) => ({
            type: 'schema_validation' as ValidationErrorType,
            message: `${err.path.join('.')}: ${err.message}`,
        }));
        errors.push(...schemaErrors);
        const validatedCurrentConfig = LLMConfigSchema.parse(currentConfig);
        return { config: validatedCurrentConfig, isValid: false, errors, warnings };
    }

    logger.debug(
        `Built and validated LLM config: provider=${config.provider}, model=${config.model}, router=${config.router}`
    );

    return {
        config,
        isValid: true,
        errors: [],
        warnings,
    };
}

// Helper functions for building LLM config

function resolveModel(
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    errors: ValidationError[]
): string {
    if (updates.model !== undefined) {
        if (typeof updates.model !== 'string' || updates.model.trim() === '') {
            errors.push({
                type: 'invalid_model',
                message: 'Model must be a non-empty string',
            });
            return '';
        }
        return updates.model.trim();
    }
    return currentConfig.model;
}

function resolveProvider(
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    model: string,
    errors: ValidationError[],
    _warnings: string[]
): string {
    if (updates.provider !== undefined) {
        // Explicit provider provided
        if (typeof updates.provider !== 'string' || updates.provider.trim() === '') {
            errors.push({
                type: 'invalid_provider',
                message: 'Provider must be a non-empty string',
            });
            return '';
        }

        const providerName = updates.provider.trim();
        if (!isValidProvider(providerName)) {
            errors.push({
                type: 'invalid_provider',
                message: `Unknown provider: ${providerName}`,
                provider: providerName,
            });
            return '';
        }

        return providerName;
    } else if (updates.model !== undefined && model !== currentConfig.model) {
        // Model changed but provider not specified - infer provider
        try {
            const inferredProvider = getProviderFromModel(model);
            if (inferredProvider !== currentConfig.provider) {
                logger.info(`Inferred provider '${inferredProvider}' from model '${model}'`);
            }
            return inferredProvider;
        } catch (_error) {
            errors.push({
                type: 'general',
                message: `Could not infer provider from model '${model}'. Please specify provider explicitly.`,
            });
            return '';
        }
    }

    // No provider update and no model change - keep current provider
    return currentConfig.provider;
}

function resolveModelProviderCompatibility(
    model: string,
    provider: string,
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    errors: ValidationError[],
    warnings: string[]
): { finalModel: string; finalProvider: string } {
    if (isValidProviderModel(provider, model)) {
        return { finalModel: model, finalProvider: provider };
    }

    // Incompatible - try to fix if provider was changed without model
    if (updates.provider && !updates.model) {
        const defaultModel = getDefaultModelForProvider(provider);
        if (defaultModel) {
            logger.info(
                `Model '${model}' incompatible with provider '${provider}', using default model '${defaultModel}'`
            );
            warnings.push(`Switched to default model '${defaultModel}' for provider '${provider}'`);
            return { finalModel: defaultModel, finalProvider: provider };
        }
    }

    // Can't fix - this is an error
    const supportedModels = getSupportedModels(provider);
    errors.push({
        type: 'incompatible_model_provider',
        message: `Model '${model}' is not supported for provider '${provider}'. Supported models: ${supportedModels.join(', ')}`,
        provider,
        model,
    });
    return { finalModel: model, finalProvider: provider };
}

function resolveRouter(
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    provider: string,
    errors: ValidationError[],
    warnings: string[]
): 'vercel' | 'in-built' {
    if (updates.router !== undefined) {
        if (!isValidRouter(updates.router)) {
            errors.push({
                type: 'unsupported_router',
                message: 'Router must be either "vercel" or "in-built"',
                router: updates.router,
            });
            return 'vercel';
        }

        if (!isRouterSupportedForProvider(provider, updates.router)) {
            const supportedRouters = getSupportedRoutersForProvider(provider);
            errors.push({
                type: 'unsupported_router',
                message: `Provider '${provider}' does not support '${updates.router}' router. Supported routers: ${supportedRouters.join(', ')}`,
                provider,
                router: updates.router,
            });
            return 'vercel';
        }

        return updates.router;
    }

    // Try to keep current router if compatible with new provider
    if (currentConfig.router && isRouterSupportedForProvider(provider, currentConfig.router)) {
        return currentConfig.router;
    }

    // Current router not supported - find a compatible one
    const supportedRouters = getSupportedRoutersForProvider(provider);
    if (supportedRouters.length === 0) {
        errors.push({
            type: 'unsupported_router',
            message: `Provider '${provider}' is not supported by any router`,
            provider,
        });
        return 'vercel';
    }

    const newRouter = supportedRouters.includes('vercel')
        ? 'vercel'
        : (supportedRouters[0] as 'vercel' | 'in-built');

    logger.info(
        `Current router '${currentConfig.router}' not supported by provider '${provider}', switching to '${newRouter}'`
    );
    warnings.push(
        `Switched router from '${currentConfig.router}' to '${newRouter}' for provider '${provider}'`
    );

    return newRouter;
}

async function resolveApiKey(
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    provider: string,
    errors: ValidationError[],
    warnings: string[]
): Promise<string> {
    const providerChanged = provider !== currentConfig.provider;

    if (updates.apiKey !== undefined) {
        // Explicit API key provided
        if (updates.apiKey && updates.apiKey.length < 10) {
            warnings.push('API key seems too short - please verify it is correct');
        }
        return updates.apiKey;
    } else if (providerChanged) {
        // Provider changed - resolve from environment
        const resolvedApiKey = resolveApiKeyForProvider(provider);
        if (resolvedApiKey) {
            logger.info(`Resolved API key for provider '${provider}' from environment`);
            return resolvedApiKey;
        } else {
            errors.push({
                type: 'missing_api_key',
                message: `No API key found for provider '${provider}'. Please set the appropriate environment variable or provide apiKey explicitly.`,
                provider,
            });
            return '';
        }
    } else {
        // Provider unchanged - keep existing API key
        return currentConfig.apiKey;
    }
}

function buildFinalConfig(
    core: { provider: string; model: string; router: 'vercel' | 'in-built'; apiKey: string },
    updates: Partial<LLMConfig>,
    currentConfig: LLMConfig,
    errors: ValidationError[],
    warnings: string[]
): ValidatedLLMConfig {
    // Base URL
    let baseURL: string | undefined;
    if (updates.baseURL !== undefined) {
        if (!supportsBaseURL(core.provider)) {
            errors.push({
                type: 'invalid_base_url',
                message: `Custom baseURL is not supported for ${core.provider} provider`,
                provider: core.provider,
            });
        } else {
            baseURL = updates.baseURL;
        }
    } else if (currentConfig.baseURL && supportsBaseURL(core.provider)) {
        baseURL = currentConfig.baseURL;
    } else if (currentConfig.baseURL && !supportsBaseURL(core.provider)) {
        warnings.push(
            `Removed custom baseURL because provider '${core.provider}' doesn't support it`
        );
    }

    let maxInputTokens: number | undefined;
    if (updates.maxInputTokens !== undefined) {
        if (typeof updates.maxInputTokens !== 'number' || updates.maxInputTokens <= 0) {
            errors.push({
                type: 'invalid_max_tokens',
                message: 'maxInputTokens must be a positive number',
            });
        } else {
            maxInputTokens = updates.maxInputTokens;
        }
    } else {
        const effectiveMaxInputTokens = getEffectiveMaxInputTokens({
            ...core,
            maxIterations: updates.maxIterations ?? currentConfig.maxIterations,
            maxInputTokens: currentConfig.maxInputTokens,
            maxOutputTokens: currentConfig.maxOutputTokens,
            temperature: currentConfig.temperature,
            baseURL: currentConfig.baseURL,
        });
        const modelChanged = core.model !== currentConfig.model;

        if (modelChanged) {
            maxInputTokens = effectiveMaxInputTokens;
            if (
                currentConfig.maxInputTokens &&
                currentConfig.maxInputTokens !== effectiveMaxInputTokens
            ) {
                warnings.push(
                    `Updated maxInputTokens from ${currentConfig.maxInputTokens} to ${effectiveMaxInputTokens} for model '${core.model}'`
                );
            }
        } else {
            maxInputTokens = currentConfig.maxInputTokens || effectiveMaxInputTokens;
        }
    }

    return {
        provider: core.provider,
        model: core.model,
        apiKey: core.apiKey,
        router: core.router,
        maxIterations:
            updates.maxIterations !== undefined
                ? updates.maxIterations
                : currentConfig.maxIterations || 50,
        temperature:
            updates.temperature !== undefined ? updates.temperature : currentConfig.temperature,
        maxOutputTokens:
            updates.maxOutputTokens !== undefined
                ? updates.maxOutputTokens
                : currentConfig.maxOutputTokens,
        ...(baseURL && { baseURL }),
        ...(maxInputTokens && { maxInputTokens }),
    };
}

/**
 * Result type for MCP server validation
 */
export interface McpServerValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: string[];
    config: ValidatedMcpServerConfig | undefined;
}

/**
 * Validate an MCP server configuration and apply schema defaults
 */
export function validateMcpServerConfig(
    serverName: string,
    serverConfig: McpServerConfig,
    existingServerNames: string[] = []
): McpServerValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Validate server name
    if (!serverName || typeof serverName !== 'string' || serverName.trim() === '') {
        errors.push({
            type: 'schema_validation',
            message: 'Server name must be a non-empty string',
            field: 'serverName',
            suggestedAction: 'Provide a valid server name',
        });
    }

    // Validate server config using Zod schema
    try {
        McpServerConfigSchema.parse(serverConfig);
    } catch (error) {
        if (error instanceof ZodError) {
            for (const issue of error.errors) {
                errors.push({
                    type: 'schema_validation',
                    message: `Invalid server configuration: ${issue.message}`,
                    field: issue.path.join('.'),
                    suggestedAction: 'Check the server configuration format and required fields',
                });
            }
        } else {
            errors.push({
                type: 'schema_validation',
                message: `Invalid server configuration: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
                suggestedAction: 'Check the server configuration format and required fields',
            });
        }
    }

    // Additional business logic validation
    if (errors.length === 0) {
        // Check for duplicate server names (case-insensitive)
        const duplicateName = existingServerNames.find(
            (name) => name.toLowerCase() === serverName.toLowerCase() && name !== serverName
        );
        if (duplicateName) {
            warnings.push(
                `Server name '${serverName}' is similar to existing server '${duplicateName}' (case difference only)`
            );
        }

        // Type-specific validation - we know it's valid McpServerConfig at this point
        if (serverConfig.type === 'stdio') {
            if (!serverConfig.command || serverConfig.command.trim() === '') {
                errors.push({
                    type: 'schema_validation',
                    message: 'Stdio server requires a non-empty command',
                    field: 'command',
                    suggestedAction: 'Provide a valid command to execute',
                });
            }
        } else if (serverConfig.type === 'sse' || serverConfig.type === 'http') {
            const url = serverConfig.url;
            if (!url) {
                errors.push({
                    type: 'schema_validation',
                    message: 'URL is required for http/sse server types',
                    field: 'url',
                    suggestedAction: 'Provide a non-empty url string',
                });
            } else {
                try {
                    new URL(url);
                } catch {
                    errors.push({
                        type: 'schema_validation',
                        message: `Invalid URL format: ${url}`,
                        field: 'url',
                        suggestedAction: 'Provide a valid URL with protocol (http:// or https://)',
                    });
                }
            }
        }
    }

    // If validation passed, parse through schema to apply defaults
    let validatedConfig: ValidatedMcpServerConfig | undefined;
    if (errors.length === 0) {
        try {
            validatedConfig = McpServerConfigSchema.parse(serverConfig);
        } catch (schemaError) {
            if (schemaError instanceof ZodError) {
                for (const issue of schemaError.errors) {
                    errors.push({
                        type: 'schema_validation',
                        message: `Schema parsing failed: ${issue.message}`,
                        field: issue.path.join('.'),
                    });
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        config: validatedConfig,
    };
}
