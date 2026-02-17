import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import fsExtra from 'fs-extra';
import path from 'node:path';
import { getPackageManager, getPackageManagerInstallCommand } from '../utils/package-mgmt.js';
import { executeWithTimeout } from '../utils/execute.js';
import { type LLMProvider, getDefaultModelForProvider } from '@dexto/core';
import { saveProviderApiKey } from '@dexto/agent-management';
import {
    getProviderDisplayName,
    isValidApiKeyFormat,
    PROVIDER_OPTIONS,
} from '../utils/provider-setup.js';
import { generateIndexForCodeFirstDI } from '../utils/template-engine.js';

function debug(message: string): void {
    if (process.env.DEXTO_DEBUG_INIT === 'true' || process.env.DEXTO_DEBUG_ALL === 'true') {
        console.error(`[dexto:init] ${message}`);
    }
}

/**
 * Get user preferences needed to initialize a Dexto app
 * @returns The user preferences
 */
export async function getUserInputToInitDextoApp(): Promise<{
    llmProvider: LLMProvider;
    llmApiKey: string;
    directory: string;
    createExampleFile: boolean;
}> {
    const answers = await p.group(
        {
            llmProvider: () =>
                p.select({
                    message: 'Choose your AI provider',
                    options: PROVIDER_OPTIONS,
                }),
            llmApiKey: async ({ results }) => {
                const llmProvider = results.llmProvider as LLMProvider;
                const selection = await p.select({
                    message: `Enter your API key for ${getProviderDisplayName(llmProvider)}?`,
                    options: [
                        { value: 'enter', label: 'Enter', hint: 'recommended' },
                        { value: 'skip', label: 'Skip', hint: '' },
                    ],
                    initialValue: 'enter',
                });

                if (p.isCancel(selection)) {
                    p.cancel('Dexto initialization cancelled');
                    process.exit(0);
                }

                if (selection === 'enter') {
                    const apiKey = await p.password({
                        message: `Enter your ${getProviderDisplayName(llmProvider)} API key`,
                        mask: '*',
                        validate: (value) => {
                            if (!value || value.trim().length === 0) {
                                return 'API key is required';
                            }
                            if (!isValidApiKeyFormat(value.trim(), llmProvider)) {
                                return `Invalid ${getProviderDisplayName(llmProvider)} API key format`;
                            }
                            return undefined;
                        },
                    });

                    if (p.isCancel(apiKey)) {
                        p.cancel('Dexto initialization cancelled');
                        process.exit(0);
                    }

                    return apiKey;
                }
                return '';
            },
            directory: () =>
                p.text({
                    message: 'Enter the directory to add the dexto files in',
                    placeholder: 'src/',
                    defaultValue: 'src/',
                }),
            createExampleFile: () =>
                p.confirm({
                    message: 'Create a dexto example file? [Recommended]',
                    initialValue: true,
                }),
        },
        {
            onCancel: () => {
                p.cancel('Dexto initialization cancelled');
                process.exit(0);
            },
        }
    );

    // Type assertion to bypass the possible 'Symbol' type returned by p.group which is handled in onCancel
    return answers as {
        llmProvider: LLMProvider;
        directory: string;
        llmApiKey: string;
        createExampleFile: boolean;
    };
}

/**
 * Initializes an existing project with Dexto in the given directory.
 * @param directory - The directory to initialize the Dexto project in
 * @param llmProvider - The LLM provider to use
 * @param llmApiKey - The API key for the LLM provider
 * @returns The path to the created Dexto project
 */
export async function initDexto(
    directory: string,
    createExampleFile = true,
    llmProvider?: LLMProvider,
    llmApiKey?: string
): Promise<void> {
    const spinner = p.spinner();

    try {
        // install dexto
        const packageManager = getPackageManager();
        const installCommand = getPackageManagerInstallCommand(packageManager);
        spinner.start('Installing Dexto...');
        const label = 'latest';
        debug(
            `Installing Dexto using ${packageManager} with install command: ${installCommand} and label: ${label}`
        );
        try {
            await executeWithTimeout(
                packageManager,
                [
                    installCommand,
                    `@dexto/core@${label}`,
                    `@dexto/storage@${label}`,
                    // Intentionally omit tool packs to keep the example minimal.
                    // TODO: Revisit adding a default tool pack once tool IDs no longer require manual qualification.
                    'dotenv',
                ],
                { cwd: process.cwd() }
            );
        } catch (installError) {
            console.error(
                `Install error: ${
                    installError instanceof Error ? installError.message : String(installError)
                }`
            );
            throw installError; // Re-throw other errors
        }

        spinner.stop('Dexto installed successfully!');

        spinner.start('Creating Dexto files...');
        // create dexto directories (dexto)
        const result = await createDextoDirectories(directory);

        if (!result.ok) {
            spinner.stop(
                chalk.inverse(
                    `Dexto already initialized in ${path.join(directory, 'dexto')}. Would you like to overwrite it?`
                )
            );
            const overwrite = await p.confirm({
                message: 'Overwrite Dexto?',
                initialValue: false,
            });

            if (p.isCancel(overwrite) || !overwrite) {
                p.cancel('Dexto initialization cancelled');
                process.exit(1);
            }
        }

        // create dexto config file
        const dextoDir = path.join(directory, 'dexto');

        // create dexto example file if requested
        if (createExampleFile) {
            debug('Creating dexto example file...');
            await createDextoExampleFile(dextoDir, { llmProvider });
            debug('Dexto example file created successfully!');
        }

        // add/update .env file (only if user provided a key)
        spinner.start('Saving API key to .env file...');
        debug(`Saving API key: provider=${llmProvider ?? 'none'}, hasApiKey=${Boolean(llmApiKey)}`);
        if (llmProvider && llmApiKey) {
            await saveProviderApiKey(llmProvider, llmApiKey, process.cwd());
        }
        spinner.stop('Saved .env updates');
    } catch (err) {
        spinner.stop(chalk.inverse(`An error occurred initializing Dexto project - ${err}`));
        debug(`Error: ${String(err)}`);
        process.exit(1);
    }
}

/** Adds notes for users to get started with their new initialized Dexto project */
export async function postInitDexto(directory: string) {
    const nextSteps = [
        `1. Run the example: ${chalk.cyan(`bun ${path.join(directory, 'dexto', 'dexto-example.ts')}`)}`,
        `2. Add/update your API key(s) in ${chalk.cyan('.env')}`,
        `3. Customize the agent in ${chalk.cyan(path.join(directory, 'dexto', 'dexto-example.ts'))}`,
        `4. Read more about Dexto: ${chalk.cyan('https://github.com/truffle-ai/dexto')}`,
    ].join('\n');
    p.note(nextSteps, chalk.rgb(255, 165, 0)('Next steps:'));
}
/**
 * Creates the dexto directory in the given directory.
 * @param directory - The directory to create the dexto directories in
 * @returns The path to the created dexto directory
 */
export async function createDextoDirectories(
    directory: string
): Promise<{ ok: true; dirPath: string } | { ok: false }> {
    const dirPath = path.join(directory, 'dexto');

    try {
        await fs.access(dirPath);
        return { ok: false };
    } catch {
        // fsExtra.ensureDir creates directories recursively if they don't exist
        await fsExtra.ensureDir(dirPath);
        return { ok: true, dirPath };
    }
}

/**
 * Creates an example file in the given directory showing how to use Dexto in code. This file has example code to get you started.
 * @param directory - The directory to create the example index file in
 * @returns The path to the created example index file
 */
export async function createDextoExampleFile(
    directory: string,
    options?: { llmProvider?: LLMProvider | undefined } | undefined
): Promise<string> {
    const provider = options?.llmProvider ?? 'openai';
    const model = getDefaultModelForProvider(provider) ?? 'gpt-4o';

    const indexTsContent = generateIndexForCodeFirstDI({
        projectName: 'dexto-example',
        packageName: 'dexto-example',
        description: 'Dexto example',
        llmProvider: provider,
        llmModel: model,
    });
    const outputPath = path.join(directory, 'dexto-example.ts');

    // Ensure the directory exists before writing the file
    await fs.writeFile(outputPath, indexTsContent);
    return outputPath;
}
