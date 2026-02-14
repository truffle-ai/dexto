import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { selectOrExit } from '../utils/prompt-helpers.js';
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
} from '../utils/scaffolding-utils.js';
import {
    generateIndexForCodeFirstDI,
    generateWebServerIndexForCodeFirstDI,
    generateWebAppHTML,
    generateWebAppJS,
    generateWebAppCSS,
    generateAppReadme,
} from '../utils/template-engine.js';
import { getExecutionContext } from '@dexto/agent-management';

type AppType = 'script' | 'webapp';

export interface CreateAppOptions {
    type?: AppType;
}

/**
 * Creates a Dexto application that runs an agent using programmatic configuration.
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

    const spinner = p.spinner();
    const originalCwd = process.cwd();
    let projectPath: string | undefined;

    try {
        projectPath = await createProjectDirectory(projectName, spinner);
        process.chdir(projectPath);

        await scaffoldCodeFirstDI(projectPath, projectName, appType, spinner);

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
 * Scaffold an app using programmatic configuration.
 */
async function scaffoldCodeFirstDI(
    projectPath: string,
    projectName: string,
    appType: AppType,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up app structure...');

    await ensureDirectory('src');

    // Create src/index.ts based on app type
    let indexContent: string;
    if (appType === 'webapp') {
        indexContent = generateWebServerIndexForCodeFirstDI({
            projectName,
            packageName: projectName,
            description: 'Dexto web server application',
        });

        await ensureDirectory('app');
        await ensureDirectory('app/assets');
        await fs.writeFile('app/index.html', generateWebAppHTML(projectName));
        await fs.writeFile('app/assets/main.js', generateWebAppJS());
        await fs.writeFile('app/assets/style.css', generateWebAppCSS());
    } else {
        indexContent = generateIndexForCodeFirstDI({
            projectName,
            packageName: projectName,
            description: 'Dexto application',
        });
    }

    await fs.writeFile('src/index.ts', indexContent);

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
        description: 'Dexto application',
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

    const dependencies = [
        `@dexto/core@${dextoDependencyVersion}`,
        `@dexto/storage@${dextoDependencyVersion}`,
        // Intentionally omit tool packs in the scaffold to keep the onboarding example minimal.
        // TODO: Revisit adding a default tool pack once tool IDs no longer require manual qualification.
        'dotenv',
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
