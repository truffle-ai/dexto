import { z } from 'zod';
import { getSupportedProviders } from '@core/index.js';
import chalk from 'chalk';

/**
 * Validates the command-line options.
 * @param opts - The command-line options object from commander.
 * @throws {z.ZodError} If validation fails.
 */
export function validateCliOptions(opts: any): void {
    const supportedProviders = getSupportedProviders().map((p) => p.toLowerCase());

    // Base schema for primitive shape
    const cliOptionShape = z.object({
        agent: z.string().min(1, 'Agent config file path must not be empty').optional(),
        strict: z.boolean().optional().default(false),
        verbose: z.boolean().optional().default(true),
        mode: z.enum(['cli', 'web', 'server', 'discord', 'telegram', 'mcp'], {
            errorMap: () => ({
                message:
                    'Mode must be one of "cli", "web", "server", "discord", "telegram", or "mcp"',
            }),
        }),
        webPort: z.string().refine(
            (val) => {
                const port = parseInt(val, 10);
                return !isNaN(port) && port > 0 && port <= 65535;
            },
            { message: 'Web port must be a number between 1 and 65535' }
        ),
        provider: z.string().optional(),
        model: z.string().optional(),
        router: z.enum(['vercel', 'in-built']).optional(),
        skipInteractive: z
            .boolean()
            .optional()
            .default(false)
            .describe('Skip interactive prompts and fail instead'),
    });

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
        webPort: opts.webPort,
        provider: opts.provider,
        model: opts.model,
        router: opts.router,
        skipInteractive: opts.skipInteractive,
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
            chalk.dim(
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
