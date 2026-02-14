import path from 'path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { selectOrExit, textOrExit } from '../utils/prompt-helpers.js';
import {
    promptForProjectName,
    createProjectDirectory,
    setupGitRepo,
    createGitignore,
    initPackageJson,
    createTsconfigForImage,
    getDextoVersionRange,
    installDependencies,
    pinDextoPackageIfUnversioned,
    ensureDirectory,
} from '../utils/scaffolding-utils.js';
import {
    generateDextoImageFile,
    generateImageReadme,
    generateExampleTool,
} from '../utils/template-engine.js';
import fs from 'fs-extra';
import { getExecutionContext } from '@dexto/agent-management';

/**
 * Creates a Dexto image project - a distributable agent harness package
 * @param name - Optional name of the image project
 * @returns The absolute path to the created project directory
 */
export async function createImage(name?: string): Promise<string> {
    console.log(chalk.blue('🎨 Creating a Dexto image - a distributable agent harness package\n'));

    // Step 1: Get project name
    const projectName = name
        ? name
        : await promptForProjectName('my-dexto-image', 'What do you want to name your image?');

    // Step 2: Get description
    const description = await textOrExit(
        {
            message: 'Describe your image:',
            placeholder: 'Custom agent harness for my organization',
            defaultValue: 'Custom agent harness for my organization',
        },
        'Image creation cancelled'
    );

    // Step 3: Starting point - new base or extend existing
    const startingPoint = await selectOrExit<'base' | 'extend'>(
        {
            message: 'Starting point:',
            options: [
                { value: 'base', label: 'New base image (build from scratch)' },
                { value: 'extend', label: 'Extend existing image (add factories to base)' },
            ],
        },
        'Image creation cancelled'
    );

    let baseImage: string | undefined;
    if (startingPoint === 'extend') {
        // Step 4: Which image to extend?
        const baseImageChoice = await selectOrExit<string>(
            {
                message: 'Which image to extend?',
                options: [
                    {
                        value: '@dexto/image-local',
                        label: '@dexto/image-local (local development)',
                    },
                    { value: 'custom', label: 'Custom npm package...' },
                ],
            },
            'Image creation cancelled'
        );

        if (baseImageChoice === 'custom') {
            const customBase = await textOrExit(
                {
                    message: 'Enter the npm package name:',
                    placeholder: '@myorg/image-base',
                    validate: (value) => {
                        if (!value || value.trim() === '') {
                            return 'Package name is required';
                        }
                        return undefined;
                    },
                },
                'Image creation cancelled'
            );

            baseImage = customBase;
        } else {
            baseImage = baseImageChoice;
        }
    }

    // Step 5: Target environment
    const target = await selectOrExit<string>(
        {
            message: 'Target environment:',
            options: [
                { value: 'local-development', label: 'Local development' },
                { value: 'cloud-production', label: 'Cloud production' },
                { value: 'edge-serverless', label: 'Edge/serverless' },
                { value: 'custom', label: 'Custom' },
            ],
        },
        'Image creation cancelled'
    );

    // Start scaffolding
    const spinner = p.spinner();
    let projectPath: string | undefined;

    try {
        // Save original cwd before changing directories (for resolving relative paths)
        const originalCwd = process.cwd();

        // Create project directory
        projectPath = await createProjectDirectory(projectName, spinner);

        // Change to project directory
        process.chdir(projectPath);

        spinner.start('Setting up project structure...');

        // Create convention-based folders
        await ensureDirectory('tools');
        await ensureDirectory('storage/blob');
        await ensureDirectory('storage/database');
        await ensureDirectory('storage/cache');
        await ensureDirectory('compaction');
        await ensureDirectory('plugins');

        // Create .gitkeep files for empty directories
        await fs.writeFile('storage/blob/.gitkeep', '');
        await fs.writeFile('storage/database/.gitkeep', '');
        await fs.writeFile('storage/cache/.gitkeep', '');
        await fs.writeFile('compaction/.gitkeep', '');
        await fs.writeFile('plugins/.gitkeep', '');

        // Create an example tool factory (gives the bundler something real to discover).
        await ensureDirectory('tools/example-tool');
        const exampleToolCode = generateExampleTool('example-tool');
        await fs.writeFile('tools/example-tool/index.ts', exampleToolCode);

        spinner.message('Generating configuration files...');

        // Create dexto.image.ts
        const dextoImageContent = generateDextoImageFile({
            projectName,
            packageName: projectName,
            description,
            imageName: projectName,
            ...(baseImage ? { baseImage } : {}),
            target,
        });
        await fs.writeFile('dexto.image.ts', dextoImageContent);

        // Create package.json
        await initPackageJson(projectPath, projectName, 'image');

        // Update package.json with build script
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        packageJson.scripts = {
            build: 'dexto-bundle build',
            typecheck: 'tsc --noEmit',
            ...packageJson.scripts,
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

        // Create tsconfig.json
        await createTsconfigForImage(projectPath);

        // Create README
        const readmeContent = generateImageReadme({
            projectName,
            packageName: projectName,
            description,
            imageName: projectName,
            ...(baseImage ? { baseImage } : {}),
        });
        await fs.writeFile('README.md', readmeContent);

        // Create .gitignore
        await createGitignore(projectPath, ['*.tsbuildinfo']);

        // Initialize git
        spinner.message('Initializing git repository...');
        await setupGitRepo(projectPath);

        spinner.message('Installing dependencies...');

        // Detect if we're in dexto source - use workspace protocol for local development
        const executionContext = getExecutionContext();
        const isDextoSource = executionContext === 'dexto-source';

        const versionRange = getDextoVersionRange();
        const dextoDependencyVersion = isDextoSource ? 'workspace:*' : versionRange;

        // Determine dependencies based on whether extending
        const dependencies: string[] = [
            `@dexto/core@${dextoDependencyVersion}`,
            `@dexto/agent-config@${dextoDependencyVersion}`,
            'zod',
        ];
        const devDependencies = [
            'typescript@^5.0.0',
            '@types/node@^20.0.0',
            `@dexto/image-bundler@${dextoDependencyVersion}`,
        ];

        if (baseImage) {
            // Resolve base image path if we're in dexto source
            let resolvedBaseImage = baseImage;
            if (isDextoSource && baseImage.startsWith('@dexto/image-')) {
                // In dexto source, resolve official images to local workspace packages
                // e.g., @dexto/image-local -> packages/image-local
                const imagePkgName = baseImage.replace('@dexto/', '');
                const imagePkgPath = path.resolve(originalCwd, 'packages', imagePkgName);
                if (await fs.pathExists(imagePkgPath)) {
                    resolvedBaseImage = imagePkgPath;
                }
            }
            const baseImageDependency = isDextoSource
                ? resolvedBaseImage
                : pinDextoPackageIfUnversioned(resolvedBaseImage, versionRange);
            dependencies.push(baseImageDependency);
        }

        // Install dependencies (use pnpm in dexto source for workspace protocol support)
        await installDependencies(
            projectPath,
            {
                dependencies,
                devDependencies,
            },
            isDextoSource ? 'pnpm' : undefined
        );

        spinner.stop(chalk.green(`✓ Successfully created image: ${projectName}`));

        console.log(`\n${chalk.cyan('Next steps:')}`);
        console.log(`  ${chalk.gray('$')} cd ${projectName}`);
        console.log(`  ${chalk.gray('$')} pnpm run build`);
        console.log(
            `\n${chalk.gray('Add your custom providers to the convention-based folders:')}`
        );
        console.log(`  ${chalk.gray('tools/')}            - Tool factories`);
        console.log(`  ${chalk.gray('storage/blob/')}     - Blob storage factories`);
        console.log(`  ${chalk.gray('storage/database/')} - Database factories`);
        console.log(`  ${chalk.gray('storage/cache/')}    - Cache factories`);
        console.log(`  ${chalk.gray('compaction/')}       - Compaction factories`);
        console.log(`  ${chalk.gray('plugins/')}          - Plugin factories`);

        console.log(`\n${chalk.gray('Install into the Dexto CLI:')}`);
        if (isDextoSource) {
            console.log(`  ${chalk.gray('$')} dexto image install .`);
            console.log(
                chalk.dim(
                    `  (linked install from local directory; workspace:* deps can't be installed into the global store)`
                )
            );
        } else {
            console.log(`  ${chalk.gray('$')} npm pack`);
            console.log(`  ${chalk.gray('$')} dexto image install ./<generated-file>.tgz`);
        }
        console.log(`\n${chalk.gray('Use it in an agent YAML:')}`);
        console.log(`  ${chalk.gray('image:')} '${projectName}'`);
        console.log(`  ${chalk.gray('# or:')} dexto --image ${projectName}\n`);
    } catch (error) {
        if (spinner) {
            spinner.stop(chalk.red('✗ Failed to create image'));
        }
        throw error;
    }

    if (!projectPath) {
        throw new Error('Failed to create project directory');
    }

    return projectPath;
}
