import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { executeWithTimeout } from '../utils/execute.js';
import * as p from '@clack/prompts';
import {
    getPackageManager,
    getPackageManagerInstallCommand,
    addScriptsToPackageJson,
} from '../utils/package-mgmt.js';
import { logger } from '@core/index.js';

/**
 * Creates basic scaffolding for a Dexto project
 * sets up git and gitignore, and sets up initial dependencies
 * Does not add scripts to package.json or create tsconfig.json which require the directory name
 * @param name - The name of the project
 * @returns The absolute path to the created project directory
 */
export async function createDextoProject(name?: string): Promise<string> {
    // Basic regex: must start with a letter, contain only letters, numbers, hyphens or underscores
    const nameRegex = /^[a-zA-Z][a-zA-Z0-9-_]*$/;

    let projectName: string;
    if (name) {
        // Validate provided project name
        if (!nameRegex.test(name)) {
            console.log(
                chalk.red(
                    'Invalid project name. Must start with a letter and contain only letters, numbers, hyphens or underscores.'
                )
            );
            process.exit(1);
        }
        projectName = name;
    } else {
        let input;
        do {
            input = await p.text({
                message: 'What do you want to name your Dexto project?',
                placeholder: 'my-dexto-project',
                defaultValue: 'my-dexto-project',
            });

            if (p.isCancel(input)) {
                p.cancel('Project creation cancelled');
                process.exit(0);
            }

            if (!nameRegex.test(input)) {
                console.log(
                    chalk.red(
                        'Invalid project name. Must start with a letter and contain only letters, numbers, hyphens or underscores.'
                    )
                );
            }
        } while (!nameRegex.test(input));
        projectName = input;
    }

    const spinner = p.spinner();
    const projectPath = path.resolve(process.cwd(), projectName);

    spinner.start(`Creating dexto project in ${projectPath}...`);
    try {
        await fs.mkdir(projectPath);
    } catch (error) {
        // if the directory already exists, end the process
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            spinner.stop(
                `Directory "${projectName}" already exists. Please choose a different name or delete the existing directory.`
            );
            process.exit(1);
        } else {
            // If it's not an EEXIST error, rethrow it to be caught by the outer catch
            spinner.stop(`Failed to create project: ${error}`);
            throw error;
        }
    }

    // Move to the new project directory
    process.chdir(projectPath);

    // initialize package.json
    await executeWithTimeout('npm', ['init', '-y'], { cwd: projectPath });

    // initialize git repository
    await executeWithTimeout('git', ['init'], { cwd: projectPath });
    // add .gitignore
    await fs.writeFile('.gitignore', 'node_modules\n.env\ndist\n.dexto\n*.log');

    // update package.json module type
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    packageJson.type = 'module';
    await fs.writeFile('package.json', JSON.stringify(packageJson, null, 2));

    spinner.stop('Project files created successfully!');

    spinner.start('Installing dependencies...');
    const packageManager = getPackageManager();
    const installCommand = getPackageManagerInstallCommand(packageManager);

    // install yaml and dotenv
    await executeWithTimeout(packageManager, [installCommand, 'yaml', 'dotenv'], {
        cwd: projectPath,
    });

    // install typescript
    await executeWithTimeout(
        packageManager,
        [installCommand, 'typescript', 'tsx', 'ts-node', '@types/node', '--save-dev'],
        { cwd: projectPath }
    );

    spinner.stop('Dependencies installed!');

    return projectPath;
}

/**
 * Adds the dexto scripts to the package.json. Assumes the package.json already exists and is accessible
 * @param directory - The directory of the project
 */
export async function addDextoScriptsToPackageJson(directory: string, projectPath: string) {
    logger.debug(`Adding dexto scripts to package.json in ${projectPath}`);
    await addScriptsToPackageJson({
        build: 'tsc',
        start: `node dist/${path.join('dexto', 'dexto-example.js')}`,
        dev: `node --loader ts-node/esm ${path.join(directory, 'dexto', 'dexto-example.ts')}`,
    });
    logger.debug(`Successfully added dexto scripts to package.json in ${projectPath}`);
}

/** Creates a tsconfig.json file in the project directory */
export async function createTsconfigJson(projectPath: string, directory: string) {
    // setup tsconfig.json
    logger.debug(`Creating tsconfig.json in ${projectPath}`);
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'node',
            strict: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
            skipLibCheck: true,
            outDir: 'dist',
            rootDir: directory,
        },
        include: [`${directory}/**/*.ts`],
        exclude: ['node_modules', 'dist', '.dexto'],
    };
    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 4 });
    logger.debug(`Successfully created tsconfig.json in ${projectPath}`);
}

/** Adds notes for users to get started with their new initialized Dexto project */
export async function postCreateDexto(projectPath: string, directory: string) {
    const nextSteps = [
        `1. Go to the project directory: ${chalk.cyan(`cd ${projectPath}`)}`,
        `2. Run the example: ${chalk.cyan(`npm run dev`)}`,
        `3. Add/update your API key(s) in ${chalk.cyan('.env')}`,
        `4. Check out the agent configuration file ${chalk.cyan(path.join(directory, 'dexto', 'agents', 'agent.yml'))}`,
        `5. Try out different LLMs and MCP servers in the agent.yml file`,
        `6. Read more about Dexto: ${chalk.cyan('https://github.com/truffle-ai/dexto')}`,
    ].join('\n');
    p.note(nextSteps, chalk.yellow('Next steps:'));
}
