import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
    getDefaultImageStoreDir,
    getImagePackageInstallDir,
    isFileLikeImageSpecifier,
    loadImageRegistry,
    parseImageSpecifier,
    resolveFileLikeImageSpecifierToFileUrl,
    resolveFileLikeImageSpecifierToPath,
    resolveImageEntryFileFromStore,
    saveImageRegistry,
} from '@dexto/agent-management';
import { loadImage } from '@dexto/agent-config';
import { executeWithTimeout } from './execute.js';

export interface InstallImageOptions {
    force?: boolean;
    activate?: boolean;
    storeDir?: string;
    installTimeoutMs?: number;
}

export interface InstallImageResult {
    id: string;
    version: string;
    entryFile: string;
    installDir: string;
    installMode: 'store' | 'linked';
}

function hasWorkspaceProtocolDependencies(pkg: unknown): boolean {
    if (typeof pkg !== 'object' || pkg === null) {
        return false;
    }

    const maybePkg = pkg as Record<string, unknown>;
    const depFields = [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
    ];

    for (const field of depFields) {
        const deps = maybePkg[field];
        if (typeof deps !== 'object' || deps === null) {
            continue;
        }

        for (const version of Object.values(deps as Record<string, unknown>)) {
            if (typeof version === 'string' && version.startsWith('workspace:')) {
                return true;
            }
        }
    }

    return false;
}

async function isDirectory(filePath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(filePath);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

async function findSingleTgzFile(dir: string): Promise<string> {
    const entries = await fs.readdir(dir);
    const tgzFiles = entries.filter((entry) => entry.endsWith('.tgz'));
    if (tgzFiles.length !== 1) {
        throw new Error(
            `Expected exactly one .tgz file in ${dir}, found ${tgzFiles.length}: ${tgzFiles.join(', ')}`
        );
    }

    return path.join(dir, tgzFiles[0] ?? '');
}

function getInstalledPackageRoot(installDir: string, packageName: string): string {
    const nodeModulesDir = path.join(installDir, 'node_modules');
    if (packageName.startsWith('@')) {
        const [scope, name] = packageName.split('/');
        if (!scope || !name) {
            throw new Error(`Invalid scoped package name: ${packageName}`);
        }
        return path.join(nodeModulesDir, scope, name);
    }
    return path.join(nodeModulesDir, packageName);
}

function readJsonFile(filePath: string): unknown {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function resolveEntryFileFromPackageJson(packageRoot: string, pkg: unknown): string {
    if (typeof pkg !== 'object' || pkg === null) {
        throw new Error('Invalid package.json');
    }

    const maybePkg = pkg as Record<string, unknown>;

    const exportsField = maybePkg.exports;
    let entryRel: string | undefined;

    if (exportsField && typeof exportsField === 'object') {
        const rootExport =
            (exportsField as Record<string, unknown>)['.'] ??
            (exportsField as Record<string, unknown>)['./'];

        if (typeof rootExport === 'string') {
            entryRel = rootExport;
        } else if (rootExport && typeof rootExport === 'object') {
            const rootObj = rootExport as Record<string, unknown>;
            if (typeof rootObj.import === 'string') {
                entryRel = rootObj.import;
            } else if (typeof rootObj.default === 'string') {
                entryRel = rootObj.default;
            }
        }
    }

    if (!entryRel) {
        const moduleField = maybePkg.module;
        if (typeof moduleField === 'string') entryRel = moduleField;
    }

    if (!entryRel) {
        const mainField = maybePkg.main;
        if (typeof mainField === 'string') entryRel = mainField;
    }

    if (!entryRel) {
        const fallback = path.join(packageRoot, 'dist', 'index.js');
        if (existsSync(fallback)) {
            return fallback;
        }
        throw new Error(`Could not determine image entry file from package.json exports/main`);
    }

    const entryPath = path.resolve(packageRoot, entryRel);
    if (!existsSync(entryPath)) {
        throw new Error(`Image entry file not found: ${entryPath}`);
    }

    return entryPath;
}

function getInstalledImageEntryFile(installDir: string, imageId: string): string {
    const packageRoot = getInstalledPackageRoot(installDir, imageId);
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (!existsSync(packageJsonPath)) {
        throw new Error(`Installed image package.json not found at ${packageJsonPath}`);
    }

    const pkg = readJsonFile(packageJsonPath);
    const entryFilePath = resolveEntryFileFromPackageJson(packageRoot, pkg);
    return pathToFileURL(entryFilePath).href;
}

async function upsertRegistryInstall(
    imageId: string,
    version: string,
    entryFile: string,
    options: { storeDir: string; activate: boolean }
): Promise<void> {
    const registry = loadImageRegistry(options.storeDir);
    registry.images[imageId] ??= { installed: {} };
    registry.images[imageId].installed[version] = {
        entryFile,
        installedAt: new Date().toISOString(),
    };
    if (options.activate) {
        registry.images[imageId].active = version;
    }
    await saveImageRegistry(registry, options.storeDir);
}

async function validateInstalledImageModule(
    imageId: string,
    version: string,
    entryFile: string
): Promise<void> {
    try {
        await loadImage(entryFile);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Installed image '${imageId}@${version}' did not export a valid DextoImage.\n` +
                `Entry file: ${entryFile}\n` +
                message
        );
    }
}

async function installImageDirectoryByReference(options: {
    packageDir: string;
    packageJson: unknown;
    storeDir: string;
    activate: boolean;
    force: boolean;
}): Promise<InstallImageResult> {
    const { packageDir, packageJson, storeDir, activate, force } = options;

    if (typeof packageJson !== 'object' || packageJson === null) {
        throw new Error(`Invalid package.json for local image at ${packageDir}`);
    }

    const maybePkg = packageJson as Record<string, unknown>;
    const imageId = maybePkg.name;
    if (typeof imageId !== 'string' || imageId.trim().length === 0) {
        throw new Error(`Local image package.json is missing a valid 'name' field (${packageDir})`);
    }

    const version = maybePkg.version;
    if (typeof version !== 'string' || version.trim().length === 0) {
        throw new Error(
            `Local image '${imageId}' package.json is missing a valid 'version' field (${packageDir})`
        );
    }

    if (force) {
        const existingInstallDir = getImagePackageInstallDir(imageId, version, storeDir);
        await fs.rm(existingInstallDir, { recursive: true, force: true }).catch(() => {});
    }

    let entryFilePath: string;
    try {
        entryFilePath = resolveEntryFileFromPackageJson(packageDir, packageJson);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('Image entry file not found:')) {
            throw new Error(
                `Local image '${imageId}@${version}' has not been built.\n` +
                    `${message}\n` +
                    `Run: bun run build in ${packageDir}, then re-run: dexto image install ${packageDir}`
            );
        }
        throw error;
    }
    const entryFile = pathToFileURL(entryFilePath).href;

    await validateInstalledImageModule(imageId, version, entryFile);
    await upsertRegistryInstall(imageId, version, entryFile, { storeDir, activate });

    return { id: imageId, version, entryFile, installDir: packageDir, installMode: 'linked' };
}

export async function installImageToStore(
    specifier: string,
    options: InstallImageOptions = {}
): Promise<InstallImageResult> {
    const {
        force = false,
        activate = true,
        storeDir = getDefaultImageStoreDir(),
        installTimeoutMs,
    } = options;

    await fs.mkdir(storeDir, { recursive: true });

    if (isFileLikeImageSpecifier(specifier)) {
        const resolvedPath = resolveFileLikeImageSpecifierToPath(specifier);
        if (await isDirectory(resolvedPath)) {
            const localPackageJsonPath = path.join(resolvedPath, 'package.json');
            if (existsSync(localPackageJsonPath)) {
                const localPkg = readJsonFile(localPackageJsonPath);
                if (hasWorkspaceProtocolDependencies(localPkg)) {
                    // `workspace:*` dependencies can only be resolved from within the workspace.
                    // Installing this package into the global image store would break dependency
                    // resolution, so we register a linked install that points at the local build.
                    return await installImageDirectoryByReference({
                        packageDir: resolvedPath,
                        packageJson: localPkg,
                        storeDir,
                        activate,
                        force,
                    });
                }
            }
        }
    }

    const tmpDir = await fs.mkdtemp(path.join(storeDir, 'tmp-install-'));
    let installDir: string | null = null;
    let moved = false;
    try {
        const tmpPackageJsonPath = path.join(tmpDir, 'package.json');
        await fs.writeFile(
            tmpPackageJsonPath,
            JSON.stringify({ name: 'dexto-image-store', private: true }, null, 2),
            'utf-8'
        );

        let packDir: string | null = null;

        let installSpecifier = isFileLikeImageSpecifier(specifier)
            ? resolveFileLikeImageSpecifierToPath(specifier)
            : specifier;

        // `bun add <directory>` can install as a relative link, which can break when
        // the temp install directory is moved into the image store. Avoid this by packing
        // directories into a tarball and installing from the tarball instead.
        if (isFileLikeImageSpecifier(specifier) && (await isDirectory(installSpecifier))) {
            packDir = path.join(tmpDir, '.dexto-pack');
            await fs.mkdir(packDir, { recursive: true });

            await executeWithTimeout('bun', ['pm', 'pack', '--destination', packDir], {
                cwd: installSpecifier,
                ...(installTimeoutMs !== undefined && { timeoutMs: installTimeoutMs }),
            });

            installSpecifier = await findSingleTgzFile(packDir);
        }

        await executeWithTimeout('bun', ['add', installSpecifier, '--save-text-lockfile'], {
            cwd: tmpDir,
            ...(installTimeoutMs !== undefined && { timeoutMs: installTimeoutMs }),
        });

        if (packDir) {
            await fs.rm(packDir, { recursive: true, force: true }).catch(() => {});
        }

        const tmpPkgJson = readJsonFile(tmpPackageJsonPath) as {
            dependencies?: Record<string, string>;
        };

        const deps = tmpPkgJson.dependencies ? Object.keys(tmpPkgJson.dependencies) : [];
        if (deps.length !== 1) {
            throw new Error(
                `Unexpected install state: expected exactly one dependency, got ${deps.length}`
            );
        }

        const imageId = deps[0] ?? '';
        if (!imageId) {
            throw new Error(`Could not determine installed image package name`);
        }

        const packageRoot = getInstalledPackageRoot(tmpDir, imageId);
        const installedPackageJsonPath = path.join(packageRoot, 'package.json');
        const installedPackageJson = readJsonFile(installedPackageJsonPath) as {
            version?: unknown;
        };
        const version = installedPackageJson.version;
        if (typeof version !== 'string' || version.trim().length === 0) {
            throw new Error(`Installed image package has an invalid version field`);
        }

        installDir = getImagePackageInstallDir(imageId, version, storeDir);
        if (existsSync(installDir)) {
            if (!force) {
                const entryFile = getInstalledImageEntryFile(installDir, imageId);
                await validateInstalledImageModule(imageId, version, entryFile);
                await upsertRegistryInstall(imageId, version, entryFile, { storeDir, activate });
                await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
                return { id: imageId, version, entryFile, installDir, installMode: 'store' };
            }

            await fs.rm(installDir, { recursive: true, force: true });
        }

        await fs.mkdir(path.dirname(installDir), { recursive: true });
        await fs.rename(tmpDir, installDir);
        moved = true;

        const entryFile = getInstalledImageEntryFile(installDir, imageId);
        await validateInstalledImageModule(imageId, version, entryFile);
        await upsertRegistryInstall(imageId, version, entryFile, { storeDir, activate });

        return { id: imageId, version, entryFile, installDir, installMode: 'store' };
    } catch (error) {
        if (moved && installDir) {
            await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});
        } else {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
    }
}

export async function importImageModule(
    imageName: string,
    storeDir: string = getDefaultImageStoreDir()
): Promise<unknown> {
    if (isFileLikeImageSpecifier(imageName)) {
        const fileUrl = resolveFileLikeImageSpecifierToFileUrl(imageName);
        return import(fileUrl);
    }

    const parsed = parseImageSpecifier(imageName);

    // Prefer the store when an image is installed there; fall back to host resolution.
    const storeEntryFile = await resolveImageEntryFileFromStore(parsed, storeDir);
    if (storeEntryFile) {
        return import(storeEntryFile);
    }

    try {
        return await import(parsed.id);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to import image '${imageName}': ${message}\n` +
                `Install it into the Dexto image store with: dexto image install ${imageName}`
        );
    }
}
