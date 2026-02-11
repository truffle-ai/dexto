import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getDextoGlobalPath } from '@dexto/agent-management';
import { executeWithTimeout } from './execute.js';

const ImageRegistryFileSchema = z
    .object({
        version: z.literal(1),
        images: z.record(
            z.object({
                active: z.string().optional(),
                installed: z.record(
                    z.object({
                        entryFile: z.string(),
                        installedAt: z.string(),
                    })
                ),
            })
        ),
    })
    .strict();

export type ImageRegistryFile = z.output<typeof ImageRegistryFileSchema>;

export interface ImageSpecifierParts {
    id: string;
    version?: string;
}

export interface InstallImageOptions {
    force?: boolean;
    activate?: boolean;
    storeDir?: string;
    npmTimeoutMs?: number;
}

export interface InstallImageResult {
    id: string;
    version: string;
    entryFile: string;
    installDir: string;
}

export function getDefaultImageStoreDir(): string {
    const override = process.env.DEXTO_IMAGE_STORE_DIR?.trim();
    if (override) {
        return override;
    }
    return getDextoGlobalPath('images');
}

export function getImageRegistryPath(storeDir: string = getDefaultImageStoreDir()): string {
    return path.join(storeDir, 'registry.json');
}

export function getImagePackagesDir(storeDir: string = getDefaultImageStoreDir()): string {
    return path.join(storeDir, 'packages');
}

export function isFileLikeImageSpecifier(specifier: string): boolean {
    if (specifier.startsWith('file://')) return true;
    if (specifier.startsWith('~/')) return true;
    if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
    if (path.isAbsolute(specifier)) return true;
    if (/^[a-zA-Z]:[\\/]/.test(specifier)) return true; // Windows absolute path
    return false;
}

function normalizeFileSpecifierToPath(specifier: string): string {
    if (specifier.startsWith('file://')) {
        return fileURLToPath(specifier);
    }

    if (specifier.startsWith('~/')) {
        return path.join(homedir(), specifier.slice(2));
    }

    if (path.isAbsolute(specifier)) {
        return specifier;
    }

    return path.resolve(process.cwd(), specifier);
}

function normalizeFileSpecifierToFileUrl(specifier: string): string {
    if (specifier.startsWith('file://')) {
        return specifier;
    }

    const filePath = normalizeFileSpecifierToPath(specifier);
    return pathToFileURL(filePath).href;
}

export function parseImageSpecifier(specifier: string): ImageSpecifierParts {
    const trimmed = specifier.trim();
    if (!trimmed) {
        throw new Error('Image specifier cannot be empty');
    }

    if (trimmed.startsWith('@')) {
        const slashIndex = trimmed.indexOf('/');
        if (slashIndex === -1) {
            return { id: trimmed };
        }

        const versionIndex = trimmed.indexOf('@', slashIndex + 1);
        if (versionIndex === -1) {
            return { id: trimmed };
        }

        const version = trimmed.slice(versionIndex + 1).trim();
        return {
            id: trimmed.slice(0, versionIndex),
            ...(version.length > 0 ? { version } : {}),
        };
    }

    const versionIndex = trimmed.lastIndexOf('@');
    if (versionIndex > 0) {
        const version = trimmed.slice(versionIndex + 1).trim();
        return {
            id: trimmed.slice(0, versionIndex),
            ...(version.length > 0 ? { version } : {}),
        };
    }

    return { id: trimmed };
}

export function getImagePackageInstallDir(
    imageId: string,
    version: string,
    storeDir: string = getDefaultImageStoreDir()
): string {
    const packagesDir = getImagePackagesDir(storeDir);
    const parts = imageId.startsWith('@') ? imageId.split('/') : [imageId];
    return path.join(packagesDir, ...parts, version);
}

export function loadImageRegistry(storeDir: string = getDefaultImageStoreDir()): ImageRegistryFile {
    const registryPath = getImageRegistryPath(storeDir);
    if (!existsSync(registryPath)) {
        return { version: 1, images: {} };
    }

    try {
        const raw = JSON.parse(readFileSync(registryPath, 'utf-8'));
        const parsed = ImageRegistryFileSchema.safeParse(raw);
        if (!parsed.success) {
            return { version: 1, images: {} };
        }
        return parsed.data;
    } catch {
        return { version: 1, images: {} };
    }
}

export async function saveImageRegistry(
    data: ImageRegistryFile,
    storeDir: string = getDefaultImageStoreDir()
): Promise<void> {
    const registryPath = getImageRegistryPath(storeDir);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(data, null, 2), 'utf-8');
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

export async function installImageToStore(
    specifier: string,
    options: InstallImageOptions = {}
): Promise<InstallImageResult> {
    const {
        force = false,
        activate = true,
        storeDir = getDefaultImageStoreDir(),
        npmTimeoutMs,
    } = options;

    await fs.mkdir(storeDir, { recursive: true });

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

        const installSpecifier = isFileLikeImageSpecifier(specifier)
            ? normalizeFileSpecifierToPath(specifier)
            : specifier;
        await executeWithTimeout(
            'npm',
            ['install', installSpecifier, '--no-audit', '--no-fund', '--no-package-lock'],
            { cwd: tmpDir, ...(npmTimeoutMs !== undefined && { timeoutMs: npmTimeoutMs }) }
        );

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
                await upsertRegistryInstall(imageId, version, entryFile, { storeDir, activate });
                await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
                return { id: imageId, version, entryFile, installDir };
            }

            await fs.rm(installDir, { recursive: true, force: true });
        }

        await fs.mkdir(path.dirname(installDir), { recursive: true });
        await fs.rename(tmpDir, installDir);
        moved = true;

        const entryFile = getInstalledImageEntryFile(installDir, imageId);
        await upsertRegistryInstall(imageId, version, entryFile, { storeDir, activate });

        return { id: imageId, version, entryFile, installDir };
    } catch (error) {
        if (moved && installDir) {
            await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});
        } else {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
    }
}

export async function resolveImageEntryFileFromStore(
    specifier: ImageSpecifierParts,
    storeDir: string = getDefaultImageStoreDir()
): Promise<string | null> {
    const registry = loadImageRegistry(storeDir);
    const entry = registry.images[specifier.id];
    if (!entry) {
        return null;
    }

    const installedVersions = Object.keys(entry.installed);
    if (installedVersions.length === 0) {
        return null;
    }

    const resolvedVersion = specifier.version ?? entry.active;
    if (!resolvedVersion) {
        if (installedVersions.length === 1) {
            return entry.installed[installedVersions[0] ?? '']?.entryFile ?? null;
        }
        throw new Error(
            `Image '${specifier.id}' has multiple installed versions but no active version set. Run: dexto image use ${specifier.id}@<version>`
        );
    }

    const resolved = entry.installed[resolvedVersion];
    if (!resolved) {
        throw new Error(
            `Image '${specifier.id}@${resolvedVersion}' is not installed. Run: dexto image install ${specifier.id}@${resolvedVersion}`
        );
    }

    return resolved.entryFile;
}

export async function setActiveImageVersion(
    imageId: string,
    version: string,
    storeDir: string = getDefaultImageStoreDir()
): Promise<void> {
    const registry = loadImageRegistry(storeDir);
    const entry = registry.images[imageId];
    if (!entry || !entry.installed[version]) {
        throw new Error(`Image '${imageId}@${version}' is not installed`);
    }

    entry.active = version;
    await saveImageRegistry(registry, storeDir);
}

export async function removeImageFromStore(
    imageId: string,
    options: { version?: string; storeDir?: string } = {}
): Promise<void> {
    const storeDir = options.storeDir ?? getDefaultImageStoreDir();
    const version = options.version;

    const registry = loadImageRegistry(storeDir);
    const entry = registry.images[imageId];
    if (!entry) {
        return;
    }

    if (version) {
        delete entry.installed[version];
        if (entry.active === version) {
            delete entry.active;
        }
        const installDir = getImagePackageInstallDir(imageId, version, storeDir);
        await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});

        if (Object.keys(entry.installed).length === 0) {
            delete registry.images[imageId];
        }
    } else {
        const versions = Object.keys(entry.installed);
        for (const v of versions) {
            const installDir = getImagePackageInstallDir(imageId, v, storeDir);
            await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});
        }
        delete registry.images[imageId];
    }

    await saveImageRegistry(registry, storeDir);
}

export async function importImageModule(
    imageName: string,
    storeDir: string = getDefaultImageStoreDir()
): Promise<unknown> {
    if (isFileLikeImageSpecifier(imageName)) {
        const fileUrl = normalizeFileSpecifierToFileUrl(imageName);
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
