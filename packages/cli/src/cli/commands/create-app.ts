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
    generateImageReadme,
    generateExampleTool,
} from '../utils/template-engine.js';
import { getExecutionContext } from '@dexto/agent-management';

type AppMode = 'from-image' | 'extend-image' | 'from-core';

export interface CreateAppOptions {
    fromImage?: string;
    extendImage?: string;
    fromCore?: boolean;
}

/**
 * Creates a Dexto application with three possible modes:
 * - from-image: Use existing image (simplest)
 * - extend-image: Extend image with custom providers
 * - from-core: Build from @dexto/core (advanced)
 * @param name - Optional name of the app project
 * @param options - Optional flags to specify mode and base image
 * @returns The absolute path to the created project directory
 */
export async function createDextoProject(
    name?: string,
    options?: CreateAppOptions
): Promise<string> {
    console.log(chalk.blue('🚀 Creating a Dexto application\n'));

    // Step 1: Get project name
    const projectName = name
        ? name
        : await promptForProjectName('my-dexto-app', 'What do you want to name your app?');

    // Step 2: Determine app mode (from flags or prompt)
    let mode: AppMode;
    let baseImage: string | undefined;

    if (options?.fromCore) {
        mode = 'from-core';
    } else if (options?.extendImage) {
        mode = 'extend-image';
        baseImage = options.extendImage;
    } else if (options?.fromImage) {
        mode = 'from-image';
        baseImage = options.fromImage;
    } else {
        // No flags provided, use interactive prompt
        mode = (await p.select({
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
                    label: 'Build from core (custom image)',
                    hint: 'Build a custom image without extending',
                },
            ],
        })) as AppMode;

        if (p.isCancel(mode)) {
            p.cancel('App creation cancelled');
            process.exit(0);
        }
    }

    const spinner = p.spinner();
    let projectPath: string;

    try {
        // Save original cwd before changing directories (for resolving relative paths)
        const originalCwd = process.cwd();

        // Create project directory
        projectPath = await createProjectDirectory(projectName, spinner);

        // Change to project directory
        process.chdir(projectPath);

        if (mode === 'from-core') {
            // Mode C: Build from core - custom image with bundler
            await scaffoldFromCore(projectPath, projectName, spinner);

            spinner.stop(chalk.green(`✓ Successfully created app: ${projectName}`));

            console.log(`\n${chalk.cyan('Next steps:')}`);
            console.log(`  ${chalk.dim('$')} cd ${projectName}`);
            console.log(`  ${chalk.dim('$')} pnpm run build`);
            console.log(`  ${chalk.dim('$')} pnpm start`);
            console.log(`\n${chalk.dim('Learn more:')} https://docs.dexto.ai\n`);

            return projectPath;
        }

        // For both from-image and extend-image, select the base image (if not already provided via flag)
        if (!baseImage) {
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
        }

        if (mode === 'from-image') {
            // Mode A: Use existing image
            await scaffoldFromImage(projectPath, projectName, baseImage, originalCwd, spinner);
        } else {
            // Mode B: Extend image
            await scaffoldExtendImage(projectPath, projectName, baseImage, originalCwd, spinner);
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
    originalCwd: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up app structure...');

    // Resolve package name for local images (needed for import statements)
    let packageNameForImport = imageName;
    if (imageName.startsWith('.')) {
        const fullPath = path.resolve(originalCwd, imageName);
        let packageDir = fullPath;

        // If path ends with /dist/index.js, resolve to package root (parent of dist)
        if (fullPath.endsWith('/dist/index.js') || fullPath.endsWith('\\dist\\index.js')) {
            packageDir = path.dirname(path.dirname(fullPath));
        } else if (fullPath.endsWith('.js')) {
            packageDir = path.dirname(fullPath);
        }

        // Read package.json to get the actual package name for imports
        try {
            const pkgJsonPath = path.join(packageDir, 'package.json');
            const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
            packageNameForImport = pkgJson.name;
        } catch (error) {
            logger.warn(`Could not read package.json from ${packageDir}, using path as import`);
        }
    }

    // Create folders
    await ensureDirectory('src');
    await ensureDirectory('agents');

    // Create src/index.ts
    const indexContent = generateIndexForImage({
        projectName,
        packageName: projectName,
        description: 'Dexto application',
        imageName: packageNameForImport, // Use the actual package name for imports
    });
    await fs.writeFile('src/index.ts', indexContent);

    // Create default agent config
    const agentConfig = `# Default Agent Configuration

# System prompt
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant.

# LLM configuration
llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY

# Storage - defaults to in-memory (fast, ephemeral)
# For persistence, change database to 'sqlite' and blob to 'local'
# Then install: npm install better-sqlite3
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
  blob:
    type: in-memory

# Internal tools
internalTools:
  - ask_user

# MCP servers - add external tools here
# mcpServers:
#   filesystem:
#     type: stdio
#     command: npx
#     args:
#       - -y
#       - "@modelcontextprotocol/server-filesystem"
#       - .
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

    // Resolve relative paths to absolute for local images
    // (npm needs absolute paths to package directories when installing from file system)
    let resolvedImageName = imageName;
    if (imageName.startsWith('.')) {
        const fullPath = path.resolve(originalCwd, imageName);
        // If path ends with /dist/index.js, resolve to package root (parent of dist)
        if (fullPath.endsWith('/dist/index.js') || fullPath.endsWith('\\dist\\index.js')) {
            resolvedImageName = path.dirname(path.dirname(fullPath));
        } else if (fullPath.endsWith('.js')) {
            // If it's a .js file but not the standard structure, use the directory
            resolvedImageName = path.dirname(fullPath);
        } else {
            // It's already a directory
            resolvedImageName = fullPath;
        }
    }

    // Install dependencies
    await installDependencies(projectPath, {
        dependencies: [resolvedImageName, '@dexto/agent-management', 'tsx'],
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
    originalCwd: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up extended image structure...');

    // Always include example tool for extend-image mode
    // (helps demonstrate how to extend the base image with custom providers)
    const includeExample = true;

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

# System prompt
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant with custom tools.

# LLM configuration
llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY

# Storage - defaults to in-memory (fast, ephemeral)
# For persistence, change database to 'sqlite' and blob to 'local'
# Then install: npm install better-sqlite3
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
  blob:
    type: in-memory

# Internal tools
internalTools:
  - ask_user

# Custom tools are auto-discovered from tools/ folder and registered by the image

# MCP servers - add external tools here
# mcpServers:
#   filesystem:
#     type: stdio
#     command: npx
#     args:
#       - -y
#       - "@modelcontextprotocol/server-filesystem"
#       - .
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

    // Detect if we're in dexto source - use workspace protocol for local development
    const executionContext = getExecutionContext();
    const isDextoSource = executionContext === 'dexto-source';

    const bundlerVersion = isDextoSource ? 'workspace:*' : '^1.3.0';
    const coreVersion = isDextoSource ? 'workspace:*' : '^1.3.0';
    const agentMgmtVersion = isDextoSource ? 'workspace:*' : '^1.3.0';

    // Resolve relative paths to absolute for local images
    // (npm/pnpm need absolute paths to package directories when installing from file system)
    let resolvedBaseImage = baseImage;
    if (baseImage.startsWith('.')) {
        const fullPath = path.resolve(originalCwd, baseImage);
        // If path ends with /dist/index.js, resolve to package root (parent of dist)
        if (fullPath.endsWith('/dist/index.js') || fullPath.endsWith('\\dist\\index.js')) {
            resolvedBaseImage = path.dirname(path.dirname(fullPath));
        } else if (fullPath.endsWith('.js')) {
            // If it's a .js file but not the standard structure, use the directory
            resolvedBaseImage = path.dirname(fullPath);
        } else {
            // It's already a directory
            resolvedBaseImage = fullPath;
        }
    }

    // Install dependencies (use pnpm in dexto source for workspace protocol support)
    await installDependencies(
        projectPath,
        {
            dependencies: [
                `@dexto/core@${coreVersion}`,
                'zod',
                resolvedBaseImage,
                `@dexto/agent-management@${agentMgmtVersion}`,
            ],
            devDependencies: [
                'typescript@^5.0.0',
                '@types/node@^20.0.0',
                `@dexto/bundler@${bundlerVersion}`,
                'tsx',
            ],
        },
        isDextoSource ? 'pnpm' : undefined
    );
}

/**
 * Mode C: Scaffold custom image built from @dexto/core
 * Uses bundler for auto-discovery and registration of providers
 */
async function scaffoldFromCore(
    projectPath: string,
    projectName: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up image structure...');

    // Always include example tool for from-core mode
    // (makes it easier to understand the convention-based folder structure)
    const includeExample = true;

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

    // Create dexto.image.ts (NOT extending - building from scratch)
    const dextoImageContent = generateDextoImageFile({
        projectName,
        packageName: projectName,
        description: 'Custom image built from @dexto/core',
        imageName: projectName,
        // NO baseImage - this is from-core!
        target: 'local-development',
    });
    await fs.writeFile('dexto.image.ts', dextoImageContent);

    // Create default agent config
    const agentConfig = `# Default Agent Configuration

# System prompt
systemPrompt:
  contributors:
    - id: primary
      type: static
      priority: 0
      content: |
        You are a helpful AI assistant with custom tools.

# LLM configuration
llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY

# Storage - defaults to in-memory (fast, ephemeral)
# For persistence, change database to 'sqlite' and blob to 'local'
# Then install: npm install better-sqlite3
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
  blob:
    type: in-memory

# Internal tools
internalTools:
  - ask_user

# Custom tools are auto-discovered from tools/ folder and registered by the image

# MCP servers - add external tools here
# mcpServers:
#   filesystem:
#     type: stdio
#     command: npx
#     args:
#       - -y
#       - "@modelcontextprotocol/server-filesystem"
#       - .
`;
    await fs.writeFile('agents/default.yml', agentConfig);

    spinner.message('Creating configuration files...');

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
    const readmeContent = generateImageReadme({
        projectName,
        packageName: projectName,
        description: `Custom image built from @dexto/core`,
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

    // Detect if we're in dexto source - use workspace protocol for local development
    const executionContext = getExecutionContext();
    const isDextoSource = executionContext === 'dexto-source';

    const bundlerVersion = isDextoSource ? 'workspace:*' : '^1.3.0';
    const coreVersion = isDextoSource ? 'workspace:*' : '^1.3.0';
    const agentMgmtVersion = isDextoSource ? 'workspace:*' : '^1.3.0';

    // Install dependencies (use pnpm in dexto source for workspace protocol support)
    await installDependencies(
        projectPath,
        {
            dependencies: [
                `@dexto/core@${coreVersion}`,
                'zod',
                `@dexto/agent-management@${agentMgmtVersion}`,
            ],
            devDependencies: [
                'typescript@^5.0.0',
                '@types/node@^20.0.0',
                `@dexto/bundler@${bundlerVersion}`,
                'tsx',
            ],
        },
        isDextoSource ? 'pnpm' : undefined
    );
}
