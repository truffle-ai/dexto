import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import fsExtra from 'fs-extra';
import path from 'node:path';
import { getPackageManager, getPackageManagerInstallCommand } from '../utils/package-mgmt.js';
import { executeWithTimeout } from '../utils/execute.js';
import { createRequire } from 'module';
import { LLMProvider, logger } from '@core/index.js';
import { updateDextoConfigFile, updateEnvFileWithLLMKeys } from '../utils/api-key-utils.js';

const require = createRequire(import.meta.url);

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
                    message: 'Select your LLM provider',
                    options: [
                        { value: 'openai', label: 'OpenAI', hint: 'Most popular LLM provider' },
                        { value: 'anthropic', label: 'Anthropic' },
                        { value: 'google', label: 'Google' },
                        { value: 'groq', label: 'Groq' },
                    ],
                }),
            llmApiKey: async ({ results }) => {
                const llmProvider = results.llmProvider;
                const selection = await p.select({
                    message: `Enter your API key for ${llmProvider}?`,
                    options: [
                        { value: 'skip', label: 'Skip', hint: 'default' },
                        { value: 'enter', label: 'Enter', hint: 'enter it manually' },
                    ],
                    initialValue: 'skip',
                });

                if (selection === 'enter') {
                    return await p.text({
                        message: 'Enter your API key',
                        placeholder: 'sk-...',
                    });
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
): Promise<{ success: boolean }> {
    const spinner = p.spinner();

    try {
        // install dexto
        const packageManager = getPackageManager();
        const installCommand = getPackageManagerInstallCommand(packageManager);
        spinner.start('Installing Dexto...');
        const label = 'latest';
        logger.debug(
            `Installing Dexto using ${packageManager} with install command: ${installCommand} and label: ${label}`
        );
        try {
            await executeWithTimeout(packageManager, [installCommand, `dexto@${label}`], {
                cwd: process.cwd(),
            });
        } catch (installError) {
            // Handle pnpm workspace error specifically
            logger.debug(`Install error: ${installError}`);
            if (packageManager === 'pnpm' && 'ERR_PNPM_ADDING_TO_ROOT') {
                spinner.stop(chalk.red('Error: Cannot install in pnpm workspace root'));
                p.note(
                    'You are initializing dexto in a pnpm workspace root. Go to a specific package in the workspace and run "pnpm add dexto" instead.',
                    chalk.yellow('Workspace Error')
                );
                return { success: false };
            }
            throw installError; // Re-throw other errors
        }

        spinner.stop('Dexto installed successfully!');

        spinner.start('Creating Dexto files...');
        // create dexto directories (dexto, dexto/agents)
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
            if (!overwrite) {
                return { success: false };
            }
        }

        // create dexto config file
        logger.debug('Creating dexto config file...');
        const dextoDir = path.join(directory, 'dexto');
        const agentsDir = path.join(dextoDir, 'agents');

        let configPath: string;
        try {
            configPath = await createDextoConfigFile(agentsDir);
            logger.debug(`Dexto config file created at ${configPath}`);
        } catch (configError) {
            spinner.stop(chalk.red('Failed to create agent config file'));
            logger.error(`Config creation error: ${configError}`);
            throw new Error(
                `Failed to create agent.yml: ${configError instanceof Error ? configError.message : String(configError)}`
            );
        }

        // update dexto config file based on llmProvider
        if (llmProvider) {
            logger.debug(`Updating dexto config file based on llmProvider: ${llmProvider}`);
            await updateDextoConfigFile(configPath, llmProvider);
            logger.debug(`Dexto config file updated with llmProvider: ${llmProvider}`);
        }
        // create dexto example file if requested
        if (createExampleFile) {
            logger.debug('Creating dexto example file...');
            await createDextoExampleFile(dextoDir);
            logger.debug('Dexto example file created successfully!');
        }

        // add/update .env file
        spinner.start('Updating .env file with dexto env variables...');
        logger.debug(
            `Updating .env file with dexto env variables: directory ${directory}, llmProvider: ${llmProvider}, llmApiKey: [REDACTED]`
        );
        // Use the core helper function directly
        const envFilePath = path.join(process.cwd(), '.env');
        await updateEnvFileWithLLMKeys(envFilePath, llmProvider, llmApiKey);
        spinner.stop('Updated .env file with dexto env variables...');
        return { success: true };
    } catch (err) {
        spinner.stop(chalk.inverse('An error occurred initializing Dexto project'));
        logger.debug(`Error: ${err}`);
        return { success: false };
    }
}

/** Adds notes for users to get started with their new initialized Dexto project */
export async function postInitDexto(directory: string) {
    const nextSteps = [
        `1. Run the example: ${chalk.cyan(`node --loader ts-node/esm ${path.join(directory, 'dexto', 'dexto-example.ts')}`)}`,
        `2. Add/update your API key(s) in ${chalk.cyan('.env')}`,
        `3. Check out the agent configuration file ${chalk.cyan(path.join(directory, 'dexto', 'agents', 'agent.yml'))}`,
        `4. Try out different LLMs and MCP servers in the agent.yml file`,
        `5. Read more about Dexto: ${chalk.cyan('https://github.com/truffle-ai/dexto')}`,
    ].join('\n');
    p.note(nextSteps, chalk.yellow('Next steps:'));
}
/**
 * Creates the dexto directories (dexto, dexto/agents) in the given directory.
 * @param directory - The directory to create the dexto directories in
 * @returns The path to the created dexto directory
 */
export async function createDextoDirectories(
    directory: string
): Promise<{ ok: true; dirPath: string } | { ok: false }> {
    const dirPath = path.join(directory, 'dexto');
    const agentsPath = path.join(directory, 'dexto', 'agents');

    try {
        await fs.access(dirPath);
        return { ok: false };
    } catch {
        // fsExtra.ensureDir creates directories recursively if they don't exist
        await fsExtra.ensureDir(dirPath);
        await fsExtra.ensureDir(agentsPath);
        return { ok: true, dirPath };
    }
}

/**
 * Creates a dexto config file in the given directory. Pulls the config file from the installed Dexto package.
 * @param directory - The directory to create the config file in
 * @returns The path to the created config file
 */
export async function createDextoConfigFile(directory: string): Promise<string> {
    // Ensure the directory exists
    await fsExtra.ensureDir(directory);

    try {
        // Locate the Dexto package installation directory
        const pkgJsonPath = require.resolve('dexto/package.json');
        const pkgDir = path.dirname(pkgJsonPath);
        logger.debug(`Package directory: ${pkgDir}`);

        // Build path to the configuration template for create-app (with auto-approve toolConfirmation)
        const templateConfigSrc = path.join(pkgDir, 'agents', 'agent-template.yml');
        logger.debug(`Looking for template at: ${templateConfigSrc}`);

        // Check if template exists - fail if not found
        const templateExists = await fsExtra.pathExists(templateConfigSrc);
        if (!templateExists) {
            throw new Error(
                `Template file not found at: ${templateConfigSrc}. This indicates a build issue - the template should be included in the package.`
            );
        }

        // Path to the destination config file
        const destConfigPath = path.join(directory, 'agent.yml');
        logger.debug(`Copying template to: ${destConfigPath}`);

        // Copy the config file from the Dexto package
        await fsExtra.copy(templateConfigSrc, destConfigPath);
        logger.debug(`Successfully created config file at: ${destConfigPath}`);

        return destConfigPath;
    } catch (error) {
        logger.error(`Failed to create Dexto config file: ${error}`);
        throw error;
    }
}

/**
 * Creates an example file in the given directory showing how to use Dexto in code. This file has example code to get you started.
 * @param directory - The directory to create the example index file in
 * @returns The path to the created example index file
 */
export async function createDextoExampleFile(directory: string): Promise<string> {
    // Extract the base directory from the given path (e.g., "src" from "src/dexto")
    const baseDir = path.dirname(directory);

    const configPath = `./${path.join(baseDir, 'dexto/agents/agent.yml')}`;

    const indexTsLines = [
        "import 'dotenv/config';",
        "import { DextoAgent, loadAgentConfig } from 'dexto';",
        '',
        "console.log('🚀 Starting Dexto Basic Example\\n');",
        '',
        'try {',
        '  // Load the agent configuration',
        `  const config = await loadAgentConfig('${configPath}');`,
        '',
        '  // Create a new DextoAgent instance',
        '  const agent = new DextoAgent(config);',
        '',
        '  // Start the agent (connects to MCP servers)',
        "  console.log('🔗 Connecting to MCP servers...');",
        '  await agent.start();',
        "  console.log('✅ Agent started successfully!\\n');",
        '',
        '  // Example 1: Simple task',
        "  console.log('📋 Example 1: Simple information request');",
        "  const response1 = await agent.run('What tools do you have available?');",
        "  console.log('Response:', response1);",
        "  console.log('\\n——\\n');",
        '',
        '  // Example 2: File operation',
        "  console.log('📄 Example 2: File creation');",
        '  const response2 = await agent.run(\'Create a file called test-output.txt with the content "Hello from Dexto!"\');',
        "  console.log('Response:', response2);",
        "  console.log('\\n——\\n');",
        '',
        '  // Example 3: Multi-step conversation',
        "  console.log('🗣️ Example 3: Multi-step conversation');",
        '  await agent.run(\'Create a simple HTML file called demo.html with a heading that says "Dexto Demo"\');',
        "  const response3 = await agent.run('Now add a paragraph to that HTML file explaining what Dexto is');",
        "  console.log('Response:', response3);",
        "  console.log('\\n——\\n');",
        '',
        '  // Reset conversation (clear context)',
        "  console.log('🔄 Resetting conversation context...');",
        '  agent.resetConversation();',
        '',
        '  // Example 4: Complex task',
        "  console.log('🏗️ Example 4: Complex multi-tool task');",
        '  const response4 = await agent.run(',
        "    'Create a simple webpage about AI agents with HTML, CSS, and JavaScript. ' +",
        "    'The page should have a title, some content about what AI agents are, ' +",
        "    'and a button that shows an alert when clicked.'",
        '  );',
        "  console.log('Response:', response4);",
        '',
        '  // Stop the agent (disconnect from MCP servers)',
        "  console.log('\\n🛑 Stopping agent...');",
        '  await agent.stop();',
        "  console.log('✅ Agent stopped successfully!');",
        '',
        '} catch (error) {',
        "  console.error('❌ Error:', error);",
        '}',
        '',
        "console.log('\\n📖 Read Dexto documentation to understand more about using Dexto: https://github.com/truffle-ai/dexto');",
    ];
    const indexTsContent = indexTsLines.join('\n');
    const outputPath = path.join(directory, 'dexto-example.ts');

    // Log the generated file content and paths for debugging
    logger.debug(`Creating example file with config path: ${configPath}`);
    logger.debug(`Base directory: ${baseDir}, Output path: ${outputPath}`);
    logger.debug(`Generated file content:\n${indexTsContent}`);

    // Ensure the directory exists before writing the file
    await fs.writeFile(outputPath, indexTsContent);
    return outputPath;
}
