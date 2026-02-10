import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';
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
} from '../utils/scaffolding-utils.js';
import {
    generateIndexForImage,
    generateWebServerIndex,
    generateWebAppHTML,
    generateWebAppJS,
    generateWebAppCSS,
    generateAppReadme,
    generateExampleTool,
    generateDiscoveryScript,
} from '../utils/template-engine.js';
import { getExecutionContext } from '@dexto/agent-management';

type AppMode = 'from-image' | 'from-core';
type AppType = 'script' | 'webapp';

export interface CreateAppOptions {
    fromImage?: string;
    fromCore?: boolean;
    type?: AppType;
}

/**
 * Creates a Dexto application with two possible modes:
 * - from-image: Use existing image (recommended)
 * - from-core: Build from @dexto/core with custom providers (advanced)
 *
 * Note: To create a new image that extends another image, use `dexto create-image` instead.
 *
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

    // Step 2: Determine app type
    let appType: AppType = options?.type || 'script';

    if (!options?.type) {
        appType = await selectOrExit<AppType>(
            {
                message: 'What type of app?',
                options: [
                    {
                        value: 'script',
                        label: 'Script',
                        hint: 'Simple script (default)',
                    },
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

    // Step 3: Determine app mode (from flags or prompt)
    let mode: AppMode;
    let baseImage: string | undefined;

    if (options?.fromCore) {
        mode = 'from-core';
    } else if (options?.fromImage) {
        mode = 'from-image';
        baseImage = options.fromImage;
    } else {
        // No flags provided, use interactive prompt
        mode = await selectOrExit<AppMode>(
            {
                message: 'How do you want to start?',
                options: [
                    {
                        value: 'from-image',
                        label: 'Use existing image (recommended)',
                        hint: 'Pre-built image with providers',
                    },
                    {
                        value: 'from-core',
                        label: 'Build from core (advanced)',
                        hint: 'Custom standalone app with your own providers',
                    },
                ],
            },
            'App creation cancelled'
        );
    }

    const spinner = p.spinner();
    let projectPath: string;
    const originalCwd = process.cwd();

    try {
        // Create project directory
        projectPath = await createProjectDirectory(projectName, spinner);

        // Change to project directory
        process.chdir(projectPath);

        if (mode === 'from-core') {
            // Mode C: Build from core - custom image with bundler
            await scaffoldFromCore(projectPath, projectName, spinner);

            spinner.stop(chalk.green(`✓ Successfully created app: ${projectName}`));

            console.log(`\n${chalk.cyan('Next steps:')}`);
            console.log(`  ${chalk.gray('$')} cd ${projectName}`);
            console.log(
                `  ${chalk.gray('$')} pnpm start ${chalk.gray('(discovers providers, builds, and runs)')}`
            );
            console.log(`\n${chalk.gray('Learn more:')} https://docs.dexto.ai\n`);

            return projectPath;
        }

        // For from-image mode, select the image (if not already provided via flag)
        if (!baseImage) {
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
                const customImage = await textOrExit(
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

                baseImage = customImage;
            } else {
                baseImage = imageChoice;
            }
        }

        // Scaffold from existing image
        await scaffoldFromImage(projectPath, projectName, baseImage, appType, originalCwd, spinner);

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
 * Mode A: Scaffold app using existing image
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
        } catch (_error) {
            logger.warn(`Could not read package.json from ${packageDir}, using path as import`);
        }
    }

    // Create folders
    await ensureDirectory('src');
    await ensureDirectory('agents');

    // Create src/index.ts based on app type
    let indexContent: string;
    if (appType === 'webapp') {
        indexContent = generateWebServerIndex({
            projectName,
            packageName: projectName,
            description: 'Dexto web server application',
            imageName: packageNameForImport,
        });

        // Create web app directory and files
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
            imageName: packageNameForImport,
        });
    }
    await fs.writeFile('src/index.ts', indexContent);

    // Create default agent config
    const agentConfig = `# Default Agent Configuration

# Image: Specifies the provider bundle for this agent
image: '${imageName}'

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

# Custom tools - uncomment to enable filesystem and process tools
# customTools:
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

    // Detect if we're in dexto source - use workspace protocol for local development
    const executionContext = getExecutionContext();
    const isDextoSource = executionContext === 'dexto-source';

    const agentMgmtVersion = isDextoSource ? 'workspace:*' : '^1.3.0';

    // Resolve relative paths to absolute for local images
    // (npm/pnpm need absolute paths to package directories when installing from file system)
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
    } else if (isDextoSource && imageName.startsWith('@dexto/image-')) {
        // In dexto source, resolve official images to local workspace packages
        // e.g., @dexto/image-local -> packages/image-local
        const imagePkgName = imageName.replace('@dexto/', '');
        const imagePkgPath = path.resolve(originalCwd, 'packages', imagePkgName);
        if (await fs.pathExists(imagePkgPath)) {
            resolvedImageName = imagePkgPath;
        }
    }

    // Install dependencies (use pnpm in dexto source for workspace protocol support)
    // Image is loaded as "environment" - we import from core packages directly
    const coreVersion = isDextoSource ? 'workspace:*' : '^1.3.0';
    const serverVersion = isDextoSource ? 'workspace:*' : '^1.3.0';

    const dependencies = [
        resolvedImageName, // Image provides the environment/providers
        `@dexto/core@${coreVersion}`, // Import DextoAgent from here
        `@dexto/agent-management@${agentMgmtVersion}`, // Import loadAgentConfig from here
        'tsx',
    ];

    // Add @dexto/server dependency for webapp type
    if (appType === 'webapp') {
        dependencies.push(`@dexto/server@${serverVersion}`);
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

/**
 * Mode B: Scaffold standalone app built from @dexto/core
 * Supports both dev (runtime discovery) and production (build-time discovery) workflows
 */
async function scaffoldFromCore(
    projectPath: string,
    projectName: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up app structure...');

    // Always include example tool for from-core mode
    const includeExample = true;

    // Create convention-based folders
    await ensureDirectory('src');
    await ensureDirectory('scripts');
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

    spinner.message('Generating app files...');

    // Create dexto.config.ts for provider discovery configuration
    const dextoConfigContent = `import { defineConfig } from '@dexto/core';

/**
 * Dexto Configuration
 *
 * Provider Discovery Modes:
 * - Development (pnpm dev): Runtime discovery - fast iteration, no rebuild needed
 * - Production (pnpm build): Build-time discovery - validates and optimizes everything
 *
 * This mirrors Next.js approach:
 * - next dev: Runtime compilation
 * - next build + next start: Pre-built production bundle
 */
export default defineConfig({
    providers: {
        // Auto-discover providers from convention-based folders
        autoDiscover: true,
        folders: ['tools', 'blob-store', 'compression', 'plugins'],
    },
});
`;
    await fs.writeFile('dexto.config.ts', dextoConfigContent);

    // Create build-time discovery script
    const discoveryScript = generateDiscoveryScript();
    await fs.writeFile('scripts/discover-providers.ts', discoveryScript);

    // Create app entry point - completely clean, no provider registration code
    const appIndexContent = `// Standalone Dexto app
// Development: Providers auto-discovered at runtime (pnpm dev)
// Production: Providers bundled at build time (pnpm build + pnpm start)

	import { AgentConfigSchema } from '@dexto/agent-config';
	import { DextoAgent, createLogger } from '@dexto/core';
	import { loadAgentConfig } from '@dexto/agent-management';

async function main() {
    console.log('🚀 Starting ${projectName}\\n');

    // Load agent configuration
    // In dev mode: providers discovered at runtime from dexto.config.ts
    // In production: providers pre-registered at build time
    const config = await loadAgentConfig('./agents/default.yml');
	    const validatedConfig = AgentConfigSchema.parse(config);

	    // Create agent
	    const agentLogger = createLogger({ config: validatedConfig.logger, agentId: validatedConfig.agentId });
	    const agent = new DextoAgent({
	        config: validatedConfig,
	        configPath: './agents/default.yml',
	        logger: agentLogger,
	    });

    await agent.start();
    console.log('✅ Agent started\\n');

    // Create a session
    const session = await agent.createSession();

    // Example interaction
    const response = await agent.run(
        'Hello! Can you help me understand what custom tools are available?',
        undefined, // imageDataInput
        undefined, // fileDataInput
        session.id // sessionId
    );

    console.log('Agent response:', response);

    // Cleanup
    await agent.stop();
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
`;
    await fs.writeFile('src/index.ts', appIndexContent);

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

# Custom tools are auto-discovered at runtime from tools/ folder
# See dexto.config.ts for provider discovery configuration

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

    // Create package.json for standalone app
    await initPackageJson(projectPath, projectName, 'app');

    // Add scripts for both development and production workflows
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    packageJson.scripts = {
        // Development: runtime discovery (fast iteration)
        dev: 'tsx src/index.ts',
        // Production: build-time discovery + bundling
        build: 'tsx scripts/discover-providers.ts && tsup',
        start: 'node dist/_entry.js',
        typecheck: 'tsc --noEmit',
        discover: 'tsx scripts/discover-providers.ts',
        ...packageJson.scripts,
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Create tsconfig.json
    const tsconfigContent = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['ES2022'],
            outDir: './dist',
            rootDir: './src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            declaration: true,
            declarationMap: true,
            sourceMap: true,
        },
        include: ['src/**/*', 'tools/**/*', 'blob-store/**/*', 'compression/**/*', 'plugins/**/*'],
        exclude: ['node_modules', 'dist'],
    };
    await fs.writeFile('tsconfig.json', JSON.stringify(tsconfigContent, null, 2));

    // Create tsup.config.ts - builds from generated _entry.ts for production
    const tsupConfig = `import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/_entry.ts'], // Generated by scripts/discover-providers.ts
    format: ['esm'],
    dts: false, // Skip DTS for build artifacts
    sourcemap: true,
    clean: true,
    external: ['@dexto/core', '@dexto/agent-management'],
    noExternal: [],
});
`;
    await fs.writeFile('tsup.config.ts', tsupConfig);

    // Create .gitignore - ignore generated build artifacts
    await createGitignore(projectPath, [
        '*.tsbuildinfo',
        'dist/',
        'src/_entry.ts',
        'src/_providers.ts',
    ]);

    // Create .env.example
    await createEnvExample(projectPath, {
        OPENAI_API_KEY: 'sk-...',
        ANTHROPIC_API_KEY: 'sk-ant-...',
    });

    // Create README
    const readmeContent = `# ${projectName}

Standalone Dexto app with convention-based auto-discovery.

## Getting Started

\`\`\`bash
# Install dependencies
pnpm install

# Add your API key
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Development (runtime discovery - fast iteration)
pnpm dev

# Production (build-time discovery + optimized bundle)
pnpm build
pnpm start
\`\`\`

That's it! Custom providers are discovered automatically:
- **Dev mode** (\`pnpm dev\`): Runtime discovery - add/modify providers without rebuilding
- **Production** (\`pnpm build\`): Build-time discovery - validates and bundles everything

## Project Structure

\`\`\`
${projectName}/
├── src/
│   ├── index.ts           # Your app code (clean, no boilerplate!)
│   ├── _entry.ts          # Auto-generated (build only, gitignored)
│   └── _providers.ts      # Auto-generated (build only, gitignored)
├── scripts/
│   └── discover-providers.ts  # Build-time discovery script
├── dexto.config.ts        # Provider discovery configuration
├── tools/                 # Add custom tool providers here
├── blob-store/            # Add custom blob storage providers here
├── compression/           # Add custom compression providers here
├── plugins/               # Add custom plugins here
└── agents/
    └── default.yml        # Agent configuration
\`\`\`

## Adding Custom Providers

1. Create a provider in the appropriate folder (tools/, blob-store/, compression/, plugins/)
2. Export it with the naming convention: \`<folderName>Provider\`
3. Run \`pnpm dev\` (instant) or \`pnpm build\` (validated) - everything is auto-discovered!

**Example** - Adding a custom tool:
\`\`\`typescript
// tools/my-tool/index.ts
import { z } from 'zod';

export const myToolProvider = {
    type: 'my-tool',
    configSchema: z.object({ type: z.literal('my-tool') }),
    tools: [
        {
            name: 'do_something',
            description: 'Does something useful',
            parameters: z.object({ input: z.string() }),
            execute: async ({ input }) => {
                return \`Processed: \${input}\`;
            },
        },
    ],
};
\`\`\`

That's it! No imports, no registration code needed.

## Scripts

- \`pnpm start\` - Build and run (auto-discovers providers)
- \`pnpm run dev\` - Development mode with hot reload
- \`pnpm run build\` - Build only
- \`pnpm run discover\` - Manually run provider discovery
- \`pnpm run typecheck\` - Type check

## How It Works

1. **Discovery**: Scans conventional folders for providers
2. **Generation**: Creates \`src/_providers.ts\` (registrations) and \`src/_entry.ts\` (wiring)
3. **Build**: Bundles everything into \`dist/_entry.js\`
4. **Run**: Your clean app code runs with all providers pre-registered

## Learn More

- [Dexto Documentation](https://docs.dexto.ai)
- [Custom Tools Guide](https://docs.dexto.ai/docs/guides/custom-tools)
`;
    await fs.writeFile('README.md', readmeContent);

    // Initialize git
    spinner.message('Initializing git repository...');
    await setupGitRepo(projectPath);

    spinner.message('Installing dependencies...');

    // Detect if we're in dexto source - use workspace protocol for local development
    const executionContext = getExecutionContext();
    const isDextoSource = executionContext === 'dexto-source';

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
            devDependencies: ['typescript@^5.0.0', '@types/node@^20.0.0', 'tsx', 'tsup'],
        },
        isDextoSource ? 'pnpm' : undefined
    );
}
