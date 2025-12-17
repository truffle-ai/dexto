import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';
import {
    promptForProjectName,
    createProjectDirectory,
    setupGitRepo,
    createGitignore,
    initPackageJson,
    createTsconfigForApp,
    createTsconfigForImage,
    installDependencies,
    createEnvExample,
    ensureDirectory,
} from '../utils/scaffolding-utils.js';
import {
    generateIndexForImage,
    generateDextoImageFile,
    generateAppReadme,
    generateExampleTool,
} from '../utils/template-engine.js';
import { initDexto, getUserInputToInitDextoApp } from './init-app.js';

type AppMode = 'from-image' | 'extend-image' | 'from-core';

/**
 * Creates a Dexto application with three possible modes:
 * - from-image: Use existing image (simplest)
 * - extend-image: Extend image with custom providers
 * - from-core: Build from @dexto/core (advanced)
 * @param name - Optional name of the app project
 * @returns The absolute path to the created project directory
 */
export async function createDextoProject(name?: string): Promise<string> {
    console.log(chalk.blue('🚀 Creating a Dexto application\n'));

    // Step 1: Get project name
    const projectName = name
        ? name
        : await promptForProjectName('my-dexto-app', 'What do you want to name your app?');

    // Step 2: Choose app mode
    const mode = (await p.select({
        message: 'How do you want to start?',
        options: [
            {
                value: 'from-image',
                label: 'Use official image (fastest, recommended)',
                hint: 'Pre-built harness - get started in seconds',
            },
            {
                value: 'extend-image',
                label: 'Extend official image (add custom providers)',
                hint: 'Build custom image with your tools',
            },
            {
                value: 'from-core',
                label: 'Build from core (advanced, full control)',
                hint: 'Manual harness construction',
            },
        ],
    })) as AppMode;

    if (p.isCancel(mode)) {
        p.cancel('App creation cancelled');
        process.exit(0);
    }

    const spinner = p.spinner();
    let projectPath: string;

    try {
        // Create project directory
        projectPath = await createProjectDirectory(projectName, spinner);

        // Change to project directory
        process.chdir(projectPath);

        if (mode === 'from-core') {
            // Mode C: Build from core - use existing initDexto flow
            spinner.stop('Project directory created!');

            console.log(
                chalk.yellow(
                    '\n⚠️  Advanced Pattern: Manual Harness Construction\n' +
                        'You will build a custom harness directly from @dexto/core.\n'
                )
            );

            // Call existing init flow
            const userInput = await getUserInputToInitDextoApp();

            await initDexto(
                userInput.directory,
                userInput.createExampleFile,
                userInput.llmProvider,
                userInput.llmApiKey
            );

            // Add post-creation steps
            await postCreateDexto(path.basename(projectPath), userInput.directory);

            return projectPath;
        }

        let baseImage: string;

        // For both from-image and extend-image, select the base image
        const imageChoice = (await p.select({
            message: 'Which base image?',
            options: [
                {
                    value: '@dexto/image-local',
                    label: '@dexto/image-local (recommended)',
                    hint: 'Local dev - SQLite, filesystem',
                },
                {
                    value: '@dexto/image-cloud',
                    label: '@dexto/image-cloud',
                    hint: 'Production - Postgres, S3',
                },
                {
                    value: '@dexto/image-edge',
                    label: '@dexto/image-edge',
                    hint: 'Serverless - D1, R2',
                },
                { value: 'custom', label: 'Custom npm package...' },
            ],
        })) as string;

        if (p.isCancel(imageChoice)) {
            p.cancel('App creation cancelled');
            process.exit(0);
        }

        if (imageChoice === 'custom') {
            const customImage = (await p.text({
                message: 'Enter the npm package name:',
                placeholder: '@myorg/image-custom',
                validate: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Package name is required';
                    }
                    return undefined;
                },
            })) as string;

            if (p.isCancel(customImage)) {
                p.cancel('App creation cancelled');
                process.exit(0);
            }

            baseImage = customImage;
        } else {
            baseImage = imageChoice;
        }

        if (mode === 'from-image') {
            // Mode A: Use existing image
            await scaffoldFromImage(projectPath, projectName, baseImage, spinner);
        } else {
            // Mode B: Extend image
            await scaffoldExtendImage(projectPath, projectName, baseImage, spinner);
        }

        spinner.stop(chalk.green(`✓ Successfully created app: ${projectName}`));

        console.log(`\n${chalk.cyan('Next steps:')}`);
        console.log(`  ${chalk.dim('$')} cd ${projectName}`);

        if (mode === 'extend-image') {
            console.log(`  ${chalk.dim('$')} pnpm run build`);
        }

        console.log(`  ${chalk.dim('$')} pnpm start`);
        console.log(`\n${chalk.dim('Learn more:')} https://docs.dexto.ai\n`);

        return projectPath;
    } catch (error) {
        if (spinner) {
            spinner.stop(chalk.red('✗ Failed to create app'));
        }
        throw error;
    }
}

/**
 * Mode A: Scaffold app using existing image
 */
async function scaffoldFromImage(
    projectPath: string,
    projectName: string,
    imageName: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up app structure...');

    // Create folders
    await ensureDirectory('src');
    await ensureDirectory('agents');

    // Create src/index.ts
    const indexContent = generateIndexForImage({
        projectName,
        packageName: projectName,
        description: 'Dexto application',
        imageName,
    });
    await fs.writeFile('src/index.ts', indexContent);

    // Create default agent config
    const agentConfig = `# Default Agent Configuration

name: default-agent
version: 1.0.0

llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY

storage:
  # Storage configuration provided by the image

tools:
  # Add your MCP servers and custom tools here
`;
    await fs.writeFile('agents/default.yml', agentConfig);

    spinner.message('Creating configuration files...');

    // Create package.json
    await initPackageJson(projectPath, projectName, 'app');

    // Add scripts
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    packageJson.scripts = {
        start: 'tsx src/index.ts',
        build: 'tsc',
        ...packageJson.scripts,
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Create tsconfig.json
    await createTsconfigForApp(projectPath, 'src');

    // Create README
    const readmeContent = generateAppReadme({
        projectName,
        packageName: projectName,
        description: 'Dexto application using official image',
        imageName,
    });
    await fs.writeFile('README.md', readmeContent);

    // Create .env.example
    await createEnvExample(projectPath, {
        OPENAI_API_KEY: 'sk-...',
        ANTHROPIC_API_KEY: 'sk-ant-...',
    });

    // Create .gitignore
    await createGitignore(projectPath);

    // Initialize git
    spinner.message('Initializing git repository...');
    await setupGitRepo(projectPath);

    spinner.message('Installing dependencies...');

    // Install dependencies
    await installDependencies(projectPath, {
        dependencies: [imageName, '@dexto/agent-management', 'tsx'],
        devDependencies: ['typescript@^5.0.0', '@types/node@^20.0.0'],
    });
}

/**
 * Mode B: Scaffold app that extends an image
 */
async function scaffoldExtendImage(
    projectPath: string,
    projectName: string,
    baseImage: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up extended image structure...');

    // Ask if they want example tool
    const includeExample = (await p.confirm({
        message: 'Include example custom tool?',
        initialValue: true,
    })) as boolean;

    if (p.isCancel(includeExample)) {
        p.cancel('App creation cancelled');
        process.exit(0);
    }

    // Create convention-based folders
    await ensureDirectory('tools');
    await ensureDirectory('blob-store');
    await ensureDirectory('compression');
    await ensureDirectory('plugins');
    await ensureDirectory('agents');

    // Create .gitkeep files for empty directories
    await fs.writeFile('blob-store/.gitkeep', '');
    await fs.writeFile('compression/.gitkeep', '');
    await fs.writeFile('plugins/.gitkeep', '');

    // Create example tool if requested
    if (includeExample) {
        await ensureDirectory('tools/example-tool');
        const exampleToolCode = generateExampleTool('example-tool');
        await fs.writeFile('tools/example-tool/index.ts', exampleToolCode);
    } else {
        await fs.writeFile('tools/.gitkeep', '');
    }

    spinner.message('Generating configuration files...');

    // Create dexto.image.ts (extending base image)
    const dextoImageContent = generateDextoImageFile({
        projectName,
        packageName: projectName,
        description: 'Custom image extending base',
        imageName: projectName,
        baseImage,
        target: 'local-development',
    });
    await fs.writeFile('dexto.image.ts', dextoImageContent);

    // Create default agent config
    const agentConfig = `# Default Agent Configuration

name: default-agent
version: 1.0.0

llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY

storage:
  # Storage configuration provided by the image

customTools:
  # Your custom tools are auto-discovered from tools/ folder

tools:
  # Add MCP servers here
`;
    await fs.writeFile('agents/default.yml', agentConfig);

    // Create package.json for image
    await initPackageJson(projectPath, projectName, 'image');

    // Add scripts
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    packageJson.scripts = {
        build: 'dexto-bundle build',
        start: 'pnpm run build && node dist/index.js',
        typecheck: 'tsc --noEmit',
        ...packageJson.scripts,
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Create tsconfig.json for image
    await createTsconfigForImage(projectPath);

    // Create README
    const readmeContent = generateAppReadme({
        projectName,
        packageName: projectName,
        description: `Custom image extending ${baseImage}`,
        imageName: projectName,
    });
    await fs.writeFile('README.md', readmeContent);

    // Create .env.example
    await createEnvExample(projectPath, {
        OPENAI_API_KEY: 'sk-...',
        ANTHROPIC_API_KEY: 'sk-ant-...',
    });

    // Create .gitignore
    await createGitignore(projectPath, ['*.tsbuildinfo']);

    // Initialize git
    spinner.message('Initializing git repository...');
    await setupGitRepo(projectPath);

    spinner.message('Installing dependencies...');

    // Install dependencies
    await installDependencies(projectPath, {
        dependencies: ['@dexto/core', 'zod', baseImage, '@dexto/agent-management'],
        devDependencies: ['typescript@^5.0.0', '@types/node@^20.0.0', '@dexto/bundler', 'tsx'],
    });
}

/**
 * Post-creation notes for users (used internally by from-core mode)
 */
export async function postCreateDexto(projectPath: string, directory: string) {
    const nextSteps = [
        `1. Go to the project directory: ${chalk.cyan(`cd ${projectPath}`)}`,
        `2. Run the example: ${chalk.cyan(`npm run dev`)}`,
        `3. Add/update your API key(s) in ${chalk.cyan('.env')}`,
        `4. Check out the agent configuration file ${chalk.cyan(path.join(directory, 'dexto', 'agents', 'default-agent.yml'))}`,
        `5. Try out different LLMs and MCP servers in the default-agent.yml file`,
        `6. Run dexto in your project directory to start the interactive CLI with default-agent.yml file`,
        `7. Read more about Dexto: ${chalk.cyan('https://docs.dexto.ai')}`,
    ].join('\n');
    p.note(nextSteps, chalk.yellow('Next steps:'));
}
