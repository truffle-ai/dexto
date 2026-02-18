import { z } from 'zod';
import { getSupportedProviders } from '@dexto/core';
import { isDextoAuthEnabled } from '@dexto/agent-management';
import chalk from 'chalk';

/**
 * Validates the command-line options.
 * @param opts - The command-line options object from commander.
 * @throws {z.ZodError} If validation fails.
 */
export function validateCliOptions(opts: any): void {
    const allProviders = getSupportedProviders();
    const supportedProviders = allProviders
        .filter((p) => p !== 'dexto-nova' || isDextoAuthEnabled())
        .map((p) => p.toLowerCase());

    // Base schema for primitive shape
    const cliOptionShape = z
        .object({
            agent: z.string().min(1, 'Agent name or path must not be empty').optional(),
            strict: z.boolean().optional().default(false),
            verbose: z.boolean().optional().default(true),
            mode: z.enum(['web', 'cli', 'server', 'discord', 'telegram', 'mcp'], {
                errorMap: () => ({
                    message:
                        'Mode must be one of "web", "cli", "server", "discord", "telegram", or "mcp"',
                }),
            }),
            port: z
                .string()
                .refine(
                    (val) => {
                        const port = parseInt(val, 10);
                        return !isNaN(port) && port > 0 && port <= 65535;
                    },
                    { message: 'Port must be a number between 1 and 65535' }
                )
                .optional(),
            autoApprove: z
                .boolean()
                .optional()
                .default(false)
                .describe('Automatically approve all tool executions when true'),
            elicitation: z
                .boolean()
                .optional()
                .default(true)
                .describe('Enable elicitation (set to false with --no-elicitation)'),
            provider: z.string().optional(),
            model: z.string().optional(),
            interactive: z
                .boolean()
                .optional()
                .default(true)
                .describe('Enable interactive prompts (set to false with --no-interactive)'),
        })
        .strict();

    // Basic semantic validation
    const cliOptionSchema = cliOptionShape
        // 1) provider must be one of the supported set if provided
        .refine(
            (data) => !data.provider || supportedProviders.includes(data.provider.toLowerCase()),
            {
                path: ['provider'],
                message: `Provider must be one of: ${supportedProviders.join(', ')}`,
            }
        )
        // 2) Check for DISCORD_BOT_TOKEN if mode is discord
        .refine(
            (data) => {
                if (data.mode === 'discord') {
                    return !!process.env.DISCORD_BOT_TOKEN;
                }
                return true;
            },
            {
                path: ['mode'],
                message:
                    "DISCORD_BOT_TOKEN must be set in environment variables when mode is 'discord'",
            }
        )
        // 3) Check for TELEGRAM_BOT_TOKEN if mode is telegram
        .refine(
            (data) => {
                if (data.mode === 'telegram') {
                    return !!process.env.TELEGRAM_BOT_TOKEN;
                }
                return true;
            },
            {
                path: ['mode'],
                message:
                    "TELEGRAM_BOT_TOKEN must be set in environment variables when mode is 'telegram'",
            }
        );

    // Execute validation
    cliOptionSchema.parse({
        agent: opts.agent,
        strict: opts.strict,
        verbose: opts.verbose,
        mode: opts.mode.toLowerCase(),
        port: opts.port,
        provider: opts.provider,
        model: opts.model,
        interactive: opts.interactive,
        autoApprove: opts.autoApprove,
        elicitation: opts.elicitation,
    });
}

export function handleCliOptionsError(error: unknown): never {
    if (error instanceof z.ZodError) {
        console.error(chalk.red('❌ Invalid command-line options detected:'));
        error.errors.forEach((err) => {
            const fieldName = err.path.join('.') || 'Unknown Option';
            console.error(chalk.red(`   • Option '${fieldName}': ${err.message}`));
        });
        console.error(
            chalk.gray(
                '\nPlease check your command-line arguments or run with --help for usage details.'
            )
        );
    } else {
        console.error(
            chalk.red(
                `❌ Validation error: ${error instanceof Error ? error.message : JSON.stringify(error)}`
            )
        );
    }
    process.exit(1);
}
