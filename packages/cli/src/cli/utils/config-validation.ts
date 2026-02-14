import { z } from 'zod';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    AgentConfigSchema,
    type AgentConfig,
    type ValidatedAgentConfig,
} from '@dexto/agent-config';
import {
    getPrimaryApiKeyEnvVar,
    logger,
    requiresApiKey,
    requiresBaseURL,
    resolveApiKeyForProvider,
} from '@dexto/core';
import { getGlobalPreferencesPath } from '@dexto/agent-management';
import { handleSyncAgentsCommand } from '../commands/sync-agents.js';

export interface ValidationResult {
    success: boolean;
    config?: ValidatedAgentConfig;
    errors?: string[];
    warnings?: string[];
    skipped?: boolean;
}

export interface ValidationOptions {
    agentPath?: string;
    credentialPolicy?: 'warn' | 'error' | 'ignore';
}

/**
 * Validates agent config with optional interactive fixes for user experience.
 * Uses schema parsing for structural validation and performs targeted credential checks.
 * Returns validated config with all defaults applied.
 *
 * IMPORTANT: This function NEVER exits the process. It always returns a result
 * that allows the caller to decide what to do next.
 *
 * @param config - The agent configuration to validate
 * @param interactive - Whether to allow interactive prompts to fix issues
 * @param options.credentialPolicy - Behavior when credentials are missing (warn, error, ignore)
 * @param options.agentPath - Agent config path (used for manual-edit instructions).
 */
export async function validateAgentConfig(
    config: AgentConfig,
    interactive: boolean = false,
    options?: ValidationOptions
): Promise<ValidationResult> {
    // Parse with schema to detect issues
    const parseResult = AgentConfigSchema.safeParse(config);

    if (parseResult.success) {
        const credentialIssues = preflightCredentials(parseResult.data);

        if (credentialIssues.length > 0) {
            const policy = options?.credentialPolicy ?? 'error';

            if (policy === 'error') {
                showValidationErrors(credentialIssues);
                showNextSteps();
                return { success: false, errors: credentialIssues };
            }

            if (policy === 'warn') {
                showCredentialWarnings(credentialIssues);
                return { success: true, config: parseResult.data, warnings: credentialIssues };
            }
        }

        return { success: true, config: parseResult.data, warnings: [] };
    }

    // Validation failed - handle based on mode
    logger.debug(`Agent config validation error: ${JSON.stringify(parseResult.error)}`);
    const errors = formatZodErrors(parseResult.error);

    if (!interactive) {
        // Non-interactive mode: show errors and next steps, but don't exit
        showValidationErrors(errors);
        showNextSteps();
        return { success: false, errors };
    }

    // Other validation errors - show options
    return await handleOtherErrors(errors, options);
}

/**
 * Perform a best-effort credential preflight for startup UX.
 *
 * Notes:
 * - This does not guarantee runtime success (e.g. Vertex/Bedrock auth is not fully validated here).
 * - It only checks whether required fields are present via config or env fallback.
 */
function preflightCredentials(config: ValidatedAgentConfig): string[] {
    const issues: string[] = [];
    const provider = config.llm.provider;

    // Mirror runtime behavior: config apiKey takes precedence, but env can satisfy missing config
    const resolvedApiKey = config.llm.apiKey || resolveApiKeyForProvider(provider);
    if (requiresApiKey(provider) && !resolvedApiKey?.trim()) {
        const envVar = getPrimaryApiKeyEnvVar(provider);
        issues.push(`llm.apiKey: Missing API key for provider '${provider}' – set $${envVar}`);
    }

    if (requiresBaseURL(provider)) {
        const baseURL = config.llm.baseURL;
        const envFallbackBaseURL =
            provider === 'openai-compatible'
                ? process.env.OPENAI_BASE_URL?.replace(/\/$/, '')
                : undefined;

        if (!baseURL && !envFallbackBaseURL) {
            issues.push(
                `llm.baseURL: Provider '${provider}' requires a 'baseURL'. ` +
                    `Set llm.baseURL (or $OPENAI_BASE_URL for openai-compatible).`
            );
        }
    }

    return issues;
}

/**
 * Show credential warnings in a user-friendly way.
 */
function showCredentialWarnings(warnings: string[]): void {
    console.log(chalk.rgb(255, 165, 0)('\n⚠️  Credential warnings:\n'));
    for (const warning of warnings) {
        console.log(chalk.yellow(`  • ${warning}`));
        logger.warn(warning);
    }
    console.log(chalk.gray('\n💡 Run `dexto setup` to configure credentials.\n'));
}

/**
 * Handle non-API-key validation errors interactively
 */
async function handleOtherErrors(
    errors: string[],
    options?: ValidationOptions
): Promise<ValidationResult> {
    console.log(chalk.rgb(255, 165, 0)('\n⚠️  Configuration issues detected:\n'));
    for (const error of errors) {
        console.log(chalk.red(`  • ${error}`));
    }
    console.log('');

    const action = await p.select({
        message: 'How would you like to proceed?',
        options: [
            {
                value: 'sync' as const,
                label: 'Sync agent config',
                hint: 'Update from bundled registry (recommended)',
            },
            {
                value: 'skip' as const,
                label: 'Continue anyway',
                hint: 'Try to start despite errors (may fail)',
            },
            {
                value: 'edit' as const,
                label: 'Edit configuration manually',
                hint: 'Show file path and instructions',
            },
        ],
    });

    if (p.isCancel(action)) {
        showNextSteps();
        return { success: false, errors, skipped: true };
    }

    if (action === 'sync') {
        try {
            // Run sync-agents to update the agent config
            await handleSyncAgentsCommand({ force: true, quiet: false });
            // Exit after sync - user needs to restart dexto
            p.outro(chalk.gray('Run dexto to start Dexto'));
            process.exit(0);
        } catch (error) {
            p.log.error(
                `Failed to sync agent: ${error instanceof Error ? error.message : String(error)}`
            );
            return { success: false, errors, skipped: true };
        }
    }

    if (action === 'edit') {
        showManualEditInstructions(options?.agentPath);
        return { success: false, errors, skipped: true };
    }

    // 'skip' - continue anyway
    p.log.warn('Continuing with validation errors - some features may not work correctly');
    return { success: false, errors, skipped: true };
}

/**
 * Show validation errors in a user-friendly way
 */
function showValidationErrors(errors: string[]): void {
    console.log(chalk.rgb(255, 165, 0)('\n⚠️  Configuration issues detected:\n'));
    for (const error of errors) {
        console.log(chalk.red(`  • ${error}`));
    }
    console.log('');
}

/**
 * Show next steps after validation failure
 */
function showNextSteps(): void {
    const prefsPath = getGlobalPreferencesPath();
    console.log(chalk.bold('\nNext steps:'));
    console.log(`  • Run ${chalk.cyan('dexto setup')} to reconfigure interactively`);
    console.log(`  • Edit ${chalk.cyan(prefsPath)} directly`);
    console.log(`  • Check your environment variables\n`);
}

/**
 * Show manual edit instructions
 */
function showManualEditInstructions(agentPath?: string): void {
    const prefsPath = getGlobalPreferencesPath();
    const configPaths = [`  ${chalk.cyan('Global preferences:')} ${prefsPath}`];

    if (agentPath) {
        configPaths.push(`  ${chalk.cyan('Agent config:')} ${agentPath}`);
    } else {
        configPaths.push(`  ${chalk.cyan('Agent configs:')} ~/.dexto/agents/*/`);
    }

    p.note(
        [
            `Your configuration files:`,
            ``,
            ...configPaths,
            ``,
            `Edit the appropriate file and run dexto again.`,
            ``,
            chalk.gray('Example commands:'),
            ...(agentPath
                ? [
                      chalk.gray(`  code ${agentPath}     # Open in VS Code`),
                      chalk.gray(`  nano ${agentPath}     # Edit in terminal`),
                  ]
                : [
                      chalk.gray(`  code ${prefsPath}     # Open in VS Code`),
                      chalk.gray(`  nano ${prefsPath}     # Edit in terminal`),
                  ]),
        ].join('\n'),
        'Manual Configuration'
    );
}

/**
 * Format Zod validation errors in a user-friendly way
 */
function formatZodErrors(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
        return `${path}: ${issue.message}`;
    });
}

/**
 * Note: validateAgentConfig never exits. Callers own exit behavior.
 */
