import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { selectOrExit, textOrExit } from '../utils/prompt-helpers.js';
import {
    promptForProjectName,
    createProjectDirectory,
    setupGitRepo,
    createGitignore,
    initPackageJson,
    createTsconfigForApp,
    installDependencies,
    createEnvExample,
    ensureDirectory,
    getDextoVersionRange,
    pinDextoPackageIfUnversioned,
} from '../utils/scaffolding-utils.js';
import {
    generateIndexForImage,
    generateWebServerIndex,
    generateWebAppHTML,
    generateWebAppJS,
    generateWebAppCSS,
    generateAppReadme,
} from '../utils/template-engine.js';
import { getExecutionContext } from '@dexto/agent-management';

type AppType = 'script' | 'webapp';

export interface CreateAppOptions {
    fromImage?: string;
    type?: AppType;
}

/**
 * Creates a Dexto application that runs an agent using an image.
 *
 * To create a new image with custom factories, use `dexto create-image`.
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

    // Step 2: Determine app type
    let appType: AppType = options?.type ?? 'script';

    if (!options?.type) {
        appType = await selectOrExit<AppType>(
            {
                message: 'What type of app?',
                options: [
                    { value: 'script', label: 'Script', hint: 'Simple script (default)' },
                    {
                        value: 'webapp',
                        label: 'Web App',
                        hint: 'REST API server with web frontend',
                    },
                ],
            },
            'App creation cancelled'
        );
    }

    // Step 3: Choose an image
    let imageName = options?.fromImage;
    if (!imageName) {
        const imageChoice = await selectOrExit<string>(
            {
                message: 'Which image?',
                options: [
                    {
                        value: '@dexto/image-local',
                        label: '@dexto/image-local (recommended)',
                        hint: 'Local dev - SQLite, filesystem',
                    },
                    { value: 'custom', label: 'Custom npm package...' },
                ],
            },
            'App creation cancelled'
        );

        if (imageChoice === 'custom') {
            imageName = await textOrExit(
                {
                    message: 'Enter the npm package name:',
                    placeholder: '@myorg/image-custom',
                    validate: (value) => {
                        if (!value || value.trim() === '') {
                            return 'Package name is required';
                        }
                        return undefined;
                    },
                },
                'App creation cancelled'
            );
        } else {
            imageName = imageChoice;
        }
    }

    const spinner = p.spinner();
    const originalCwd = process.cwd();
    let projectPath: string | undefined;

    try {
        projectPath = await createProjectDirectory(projectName, spinner);
        process.chdir(projectPath);

        await scaffoldFromImage(projectPath, projectName, imageName, appType, originalCwd, spinner);

        spinner.stop(chalk.green(`✓ Successfully created app: ${projectName}`));

        console.log(`\n${chalk.cyan('Next steps:')}`);
        console.log(`  ${chalk.gray('$')} cd ${projectName}`);
        console.log(`  ${chalk.gray('$')} pnpm start`);
        console.log(`\n${chalk.gray('Learn more:')} https://docs.dexto.ai\n`);

        return projectPath;
    } catch (error) {
        // Restore original directory on error
        if (originalCwd) {
            try {
                process.chdir(originalCwd);
            } catch {
                // Ignore if we can't restore - likely a more serious issue
            }
        }

        if (spinner) {
            spinner.stop(chalk.red('✗ Failed to create app'));
        }
        throw error;
    }
}

/**
 * Scaffold an app using an existing image.
 */
async function scaffoldFromImage(
    projectPath: string,
    projectName: string,
    imageName: string,
    appType: AppType,
    originalCwd: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up app structure...');

    // Config `image:` should be an import specifier (package name), never a file path.
    let imageSpecifierForConfig = imageName;

    // Advanced: user can pass a local path and we install it from filesystem,
    // but config should still reference the package name.
    if (imageName.startsWith('.')) {
        const fullPath = path.resolve(originalCwd, imageName);
        let packageDir = fullPath;

        // If path ends with /dist/index.js, resolve to package root (parent of dist)
        if (fullPath.endsWith('/dist/index.js') || fullPath.endsWith('\\dist\\index.js')) {
            packageDir = path.dirname(path.dirname(fullPath));
        } else if (fullPath.endsWith('.js')) {
            packageDir = path.dirname(fullPath);
        }

        const pkgJsonPath = path.join(packageDir, 'package.json');
        let pkgJson: unknown;
        try {
            pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
                `Could not read package.json from ${packageDir} (required to determine image package name): ${message}`
            );
        }

        if (
            !pkgJson ||
            typeof pkgJson !== 'object' ||
            !('name' in pkgJson) ||
            typeof pkgJson.name !== 'string' ||
            pkgJson.name.length === 0
        ) {
            throw new Error(`Invalid image package.json at ${pkgJsonPath}: missing "name" field`);
        }

        imageSpecifierForConfig = pkgJson.name;
    }

    await ensureDirectory('src');
    await ensureDirectory('agents');

    // Create src/index.ts based on app type
    let indexContent: string;
    if (appType === 'webapp') {
        indexContent = generateWebServerIndex({
            projectName,
            packageName: projectName,
            description: 'Dexto web server application',
            imageName: imageSpecifierForConfig,
        });

        await ensureDirectory('app');
        await ensureDirectory('app/assets');
        await fs.writeFile('app/index.html', generateWebAppHTML(projectName));
        await fs.writeFile('app/assets/main.js', generateWebAppJS());
        await fs.writeFile('app/assets/style.css', generateWebAppCSS());
    } else {
        indexContent = generateIndexForImage({
            projectName,
            packageName: projectName,
            description: 'Dexto application',
            imageName: imageSpecifierForConfig,
        });
    }

    await fs.writeFile('src/index.ts', indexContent);

    // Create default agent config
    const agentConfig = `# Default Agent Configuration

# Image: factory bundle used to resolve config → concrete services
image: '${imageSpecifierForConfig}'

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

# Storage
storage:
  cache:
    type: in-memory
  database:
    type: sqlite
    path: ./data/agent.db
  blob:
    type: local
    storePath: ./data/blobs

# Tools
# Omit \`tools\` to use image defaults.
# tools:
#   - type: builtin-tools
#   - type: filesystem-tools
#     allowedPaths: ['.']
#     blockedPaths: ['.git', 'node_modules']
#   - type: process-tools
#     securityLevel: moderate

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

    await initPackageJson(projectPath, projectName, 'app');

    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

    packageJson.scripts = {
        start: 'tsx src/index.ts',
        build: 'tsc',
        ...packageJson.scripts,
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    await createTsconfigForApp(projectPath, 'src');

    const readmeContent = generateAppReadme({
        projectName,
        packageName: projectName,
        description: 'Dexto application using an image',
        imageName: imageSpecifierForConfig,
    });
    await fs.writeFile('README.md', readmeContent);

    await createEnvExample(projectPath, {
        OPENAI_API_KEY: 'sk-...',
        ANTHROPIC_API_KEY: 'sk-ant-...',
    });

    await createGitignore(projectPath);

    spinner.message('Initializing git repository...');
    await setupGitRepo(projectPath);

    spinner.message('Installing dependencies...');

    const executionContext = getExecutionContext();
    const isDextoSource = executionContext === 'dexto-source';

    const versionRange = getDextoVersionRange();
    const dextoDependencyVersion = isDextoSource ? 'workspace:*' : versionRange;

    // Resolve relative paths to absolute for local images (npm/pnpm need absolute paths)
    let resolvedImageInstallSpecifier = imageName;
    if (imageName.startsWith('.')) {
        const fullPath = path.resolve(originalCwd, imageName);
        if (fullPath.endsWith('/dist/index.js') || fullPath.endsWith('\\dist\\index.js')) {
            resolvedImageInstallSpecifier = path.dirname(path.dirname(fullPath));
        } else if (fullPath.endsWith('.js')) {
            resolvedImageInstallSpecifier = path.dirname(fullPath);
        } else {
            resolvedImageInstallSpecifier = fullPath;
        }
    } else if (isDextoSource && imageName.startsWith('@dexto/image-')) {
        const imagePkgName = imageName.replace('@dexto/', '');
        const imagePkgPath = path.resolve(originalCwd, 'packages', imagePkgName);
        if (await fs.pathExists(imagePkgPath)) {
            resolvedImageInstallSpecifier = imagePkgPath;
        }
    }

    const imageDependency = isDextoSource
        ? resolvedImageInstallSpecifier
        : pinDextoPackageIfUnversioned(resolvedImageInstallSpecifier, versionRange);

    const dependencies = [
        imageDependency,
        `@dexto/core@${dextoDependencyVersion}`,
        `@dexto/agent-config@${dextoDependencyVersion}`,
        `@dexto/agent-management@${dextoDependencyVersion}`,
        'tsx',
    ];

    if (appType === 'webapp') {
        dependencies.push(`@dexto/server@${dextoDependencyVersion}`);
    }

    await installDependencies(
        projectPath,
        {
            dependencies,
            devDependencies: ['typescript@^5.0.0', '@types/node@^20.0.0'],
        },
        isDextoSource ? 'pnpm' : undefined
    );
}
