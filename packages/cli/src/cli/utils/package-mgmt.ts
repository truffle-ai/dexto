import { findPackageRoot, logger } from '@dexto/core';
import fsExtra from 'fs-extra';
import path from 'path';
import { PackageJson } from 'type-fest';

/**
 * Returns the install command for the given package manager
 * @param pm - The package manager to use
 * @returns The install command for the given package manager
 */
export function getPackageManagerInstallCommand(pm: string): string {
    switch (pm) {
        case 'npm':
            return 'install';
        case 'yarn':
            return 'add';
        case 'pnpm':
            return 'add';
        case 'bun':
            return 'add';
        default:
            return 'install';
    }
}

/**
 * Returns the package manager for the given project
 * @returns The package manager for the given project
 */
export function getPackageManager(): string {
    const projectRoot = findPackageRoot(process.cwd());
    if (!projectRoot) {
        return 'bun'; // Default to bun if no project root is found
    }

    // Prefer `package.json#packageManager` when available.
    // This is the most direct signal of intent and is commonly used for Bun/Corepack.
    try {
        const pkgJsonPath = path.join(projectRoot, 'package.json');
        const content = fsExtra.readJSONSync(pkgJsonPath) as PackageJson;
        const packageManager = content.packageManager;
        if (typeof packageManager === 'string') {
            if (packageManager.startsWith('bun@')) return 'bun';
            if (packageManager.startsWith('pnpm@')) return 'pnpm';
            if (packageManager.startsWith('yarn@')) return 'yarn';
            if (packageManager.startsWith('npm@')) return 'npm';
        }
    } catch {
        // ignore
    }

    // Check for specific lock files in this project
    if (
        fsExtra.existsSync(path.join(projectRoot, 'bun.lockb')) ||
        fsExtra.existsSync(path.join(projectRoot, 'bun.lock'))
    ) {
        return 'bun';
    }
    if (fsExtra.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fsExtra.existsSync(path.join(projectRoot, 'yarn.lock'))) {
        return 'yarn';
    }
    if (fsExtra.existsSync(path.join(projectRoot, 'package-lock.json'))) {
        return 'npm';
    }

    // Default to bun if no other signal is found
    return 'bun';
}

/**
 * Goes all the way up to the root of the project and checks package.json to find the version of a project
 * @returns The version of the given project
 */
export async function getPackageVersion(): Promise<string> {
    const projectRoot = findPackageRoot(process.cwd());
    if (!projectRoot) {
        throw new Error('Could not find project root');
    }
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    const content = (await fsExtra.readJSON(pkgJsonPath)) as PackageJson;
    if (!content.version) {
        throw new Error('Could not find version in package.json');
    }
    return content.version;
}

/**
 * Adds scripts to the package.json file.
 * Assumes that the package.json file is already present in the current directory
 * @param scripts - The scripts to add to the package.json file
 */
export async function addScriptsToPackageJson(scripts: Record<string, string>) {
    let packageJson;
    try {
        packageJson = await fsExtra.readJSON('package.json');
    } catch (err) {
        throw new Error(
            `Failed to read package.json: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    packageJson.scripts = {
        ...packageJson.scripts,
        ...scripts,
    };

    logger.debug(`Adding scripts to package.json: ${JSON.stringify(scripts, null, 2)}`);

    try {
        logger.debug(
            `Writing to package.json. \n Contents: ${JSON.stringify(packageJson, null, 2)}`
        );
        await fsExtra.writeJSON('package.json', packageJson, { spaces: 4 });
    } catch (err) {
        throw new Error(
            `Failed to write to package.json: ${err instanceof Error ? err.message : String(err)}`
        );
    }
}

/**
 * Checks for a package.json file in the current directory
 * Useful to decide if we are in the right folder of a valid project
 * @returns True if a package.json file is found, false otherwise
 */
export async function checkForFileInCurrentDirectory(fileName: string) {
    const file = path.join(process.cwd(), fileName);
    let isFilePresent = false;

    try {
        await fsExtra.readJSON(file);
        isFilePresent = true;
    } catch {
        isFilePresent = false;
    }

    if (isFilePresent) {
        return;
    }
    logger.debug(`${fileName} not found in the current directory.`);
    throw new FileNotFoundError(`${fileName} not found in the current directory.`);
}

/**
 * Custom error class for when a required file is not found
 */
export class FileNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FileNotFoundError';
    }
}
