import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { executeWithTimeout } from './execute.js';
import { textOrExit } from './prompt-helpers.js';
import { getPackageManager, getPackageManagerInstallCommand } from './package-mgmt.js';

/**
 * Validates a project name against the standard regex
 * @param name - The project name to validate
 * @returns Error message if invalid, undefined if valid
 */
export function validateProjectName(name: string): string | undefined {
    const nameRegex = /^[a-zA-Z][a-zA-Z0-9-_]*$/;
    if (!nameRegex.test(name)) {
        return 'Must start with a letter and contain only letters, numbers, hyphens, or underscores';
    }
    return undefined;
}

/**
 * Prompts user for project name with validation
 * @param defaultName - Default project name
 * @param promptMessage - Custom prompt message
 * @returns The validated project name
 */
export async function promptForProjectName(
    defaultName: string = 'my-dexto-project',
    promptMessage: string = 'What do you want to name your project?'
): Promise<string> {
    let input;
    do {
        input = await textOrExit(
            {
                message: promptMessage,
                placeholder: defaultName,
                defaultValue: defaultName,
            },
            'Project creation cancelled'
        );

        const error = validateProjectName(input);
        if (error) {
            console.log(chalk.red(`Invalid project name: ${error}`));
        }
    } while (validateProjectName(input));

    return input;
}

/**
 * Creates a project directory with error handling
 * @param projectName - The name of the project
 * @param spinner - Clack spinner instance
 * @returns The absolute path to the created project
 */
export async function createProjectDirectory(
    projectName: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<string> {
    const projectPath = path.resolve(process.cwd(), projectName);

    try {
        await fs.mkdir(projectPath);
        return projectPath;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            spinner.stop(
                `Directory "${projectName}" already exists. Please choose a different name or delete the existing directory.`
            );
            process.exit(1);
        } else {
            spinner.stop(`Failed to create project: ${error}`);
            throw error;
        }
    }
}

/**
 * Initializes a git repository in the project
 * @param projectPath - The project directory path
 */
export async function setupGitRepo(projectPath: string): Promise<void> {
    await executeWithTimeout('git', ['init'], { cwd: projectPath });
}

/**
 * Creates a .gitignore file with common entries
 * @param projectPath - The project directory path
 * @param additionalEntries - Additional entries to include
 */
export async function createGitignore(
    projectPath: string,
    additionalEntries: string[] = []
): Promise<void> {
    const baseEntries = ['node_modules', '.env', 'dist', '.dexto', '*.log'];
    const allEntries = [...baseEntries, ...additionalEntries];
    await fs.writeFile(path.join(projectPath, '.gitignore'), allEntries.join('\n'));
}

/**
 * Initializes package.json for a project
 * @param projectPath - The project directory path
 * @param projectName - The project name
 * @param type - Project type for package.json customization
 */
export async function initPackageJson(
    projectPath: string,
    projectName: string,
    type: 'app' | 'image' | 'project'
): Promise<void> {
    // Initialize with npm (it creates package.json regardless of package manager)
    await executeWithTimeout('npm', ['init', '-y'], { cwd: projectPath });

    // Read and customize package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

    packageJson.name = projectName;
    packageJson.version = '1.0.0';
    packageJson.type = 'module';

    // Customize based on type
    if (type === 'app') {
        packageJson.description = 'Dexto application';
    } else if (type === 'image') {
        packageJson.description = `Dexto image providing agent harness`;
        packageJson.main = './dist/index.js';
        packageJson.types = './dist/index.d.ts';
        packageJson.exports = {
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.js',
            },
        };
    } else if (type === 'project') {
        packageJson.description = 'Custom Dexto project';
        packageJson.bin = {
            [projectName]: './dist/src/index.js',
        };
    }

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

/**
 * Creates tsconfig.json for an app project
 * @param projectPath - The project directory path
 * @param srcDir - Source directory (e.g., 'src')
 */
export async function createTsconfigForApp(projectPath: string, srcDir: string): Promise<void> {
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
            rootDir: srcDir,
        },
        include: [`${srcDir}/**/*.ts`],
        exclude: ['node_modules', 'dist', '.dexto'],
    };

    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 4 });
}

/**
 * Creates tsconfig.json for an image project
 * @param projectPath - The project directory path
 */
export async function createTsconfigForImage(projectPath: string): Promise<void> {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            lib: ['ES2022'],
            moduleResolution: 'bundler',
            outDir: './dist',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            allowSyntheticDefaultImports: true,
            types: ['node'],
        },
        include: [
            'dexto.image.ts',
            'tools/**/*',
            'storage/blob/**/*',
            'storage/database/**/*',
            'storage/cache/**/*',
            'compaction/**/*',
            'plugins/**/*',
        ],
        exclude: ['node_modules', 'dist'],
    };

    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 2 });
}

/**
 * Creates tsconfig.json for a project (manual registration)
 * @param projectPath - The project directory path
 */
export async function createTsconfigForProject(projectPath: string): Promise<void> {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            lib: ['ES2022'],
            moduleResolution: 'bundler',
            outDir: './dist',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            allowSyntheticDefaultImports: true,
            types: ['node'],
        },
        include: [
            'src/**/*',
            'storage/**/*',
            'tools/**/*',
            'plugins/**/*',
            'shared/**/*',
            'dexto.config.ts',
        ],
        exclude: ['node_modules', 'dist'],
    };

    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 2 });
}

/**
 * Installs dependencies for a project
 * @param projectPath - The project directory path
 * @param deps - Dependencies to install
 */
export async function installDependencies(
    projectPath: string,
    deps: {
        dependencies?: string[];
        devDependencies?: string[];
    },
    packageManager?: string
): Promise<void> {
    const pm = packageManager || getPackageManager();
    const installCommand = getPackageManagerInstallCommand(pm);

    if (deps.dependencies && deps.dependencies.length > 0) {
        await executeWithTimeout(pm, [installCommand, ...deps.dependencies], {
            cwd: projectPath,
        });
    }

    if (deps.devDependencies && deps.devDependencies.length > 0) {
        await executeWithTimeout(pm, [installCommand, ...deps.devDependencies, '--save-dev'], {
            cwd: projectPath,
        });
    }
}

/**
 * Creates a .env.example file
 * @param projectPath - The project directory path
 * @param entries - Environment variables to include (key-value pairs)
 */
export async function createEnvExample(
    projectPath: string,
    entries: Record<string, string>
): Promise<void> {
    const content = Object.entries(entries)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    await fs.writeFile(path.join(projectPath, '.env.example'), content);
}

/**
 * Ensures a directory exists, creates if not
 * @param dirPath - The directory path to ensure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.ensureDir(dirPath);
}
