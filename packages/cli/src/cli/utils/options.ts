import { z } from 'zod';
import { getSupportedProviders } from '@dexto/llm';
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
            permissionsMode: z.enum(['manual', 'auto-approve']).optional(),
            autoApprove: z
                .boolean()
                .optional()
                .default(false)
                .describe('Automatically approve all tool executions when true'),
            bypassPermissions: z
                .boolean()
                .optional()
                .default(false)
                .describe('Select auto-approve permissions'),
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
        // provider must be one of the supported set if provided
        .refine(
            (data) => !data.provider || supportedProviders.includes(data.provider.toLowerCase()),
            {
                path: ['provider'],
                message: `Provider must be one of: ${supportedProviders.join(', ')}`,
            }
        );

    // Execute validation
    cliOptionSchema.parse({
        agent: opts.agent,
        strict: opts.strict,
        verbose: opts.verbose,
        provider: opts.provider,
        model: opts.model,
        interactive: opts.interactive,
        permissionsMode: opts.permissionsMode,
        autoApprove: opts.autoApprove,
        bypassPermissions: opts.bypassPermissions,
        elicitation: opts.elicitation,
    });
}

export function handleCliOptionsError(error: unknown): never {
    if (error instanceof z.ZodError) {
        console.error(chalk.red('❌ Invalid command-line options detected:'));
        error.issues.forEach((err) => {
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
