import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { z } from 'zod';
import { getDextoGlobalPath } from '../utils/path.js';

const ImageRegistryFileSchema = z
    .object({
        version: z.literal(1),
        images: z.record(
            z
                .object({
                    active: z.string().optional(),
                    installed: z.record(
                        z
                            .object({
                                entryFile: z.string(),
                                installedAt: z.string(),
                            })
                            .strict()
                    ),
                })
                .strict()
        ),
    })
    .strict();

export type ImageRegistryFile = z.output<typeof ImageRegistryFileSchema>;

export interface ImageSpecifierParts {
    id: string;
    version?: string;
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

    const tempPath = `${registryPath}.tmp.${Date.now()}`;
    try {
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), {
            encoding: 'utf-8',
            mode: 0o600,
        });
        await fs.rename(tempPath, registryPath);
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
    }
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

export function isFileLikeImageSpecifier(specifier: string): boolean {
    if (specifier === '.' || specifier === '..') return true;
    if (specifier.startsWith('file://')) return true;
    if (specifier.startsWith('~/')) return true;
    if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
    if (path.isAbsolute(specifier)) return true;
    if (/^[a-zA-Z]:[\\/]/.test(specifier)) return true; // Windows absolute path
    return false;
}

export function resolveFileLikeImageSpecifierToPath(
    specifier: string,
    cwd: string = process.cwd()
): string {
    if (specifier.startsWith('file://')) {
        return fileURLToPath(specifier);
    }

    if (specifier.startsWith('~/')) {
        return path.join(homedir(), specifier.slice(2));
    }

    if (path.isAbsolute(specifier)) {
        return specifier;
    }

    return path.resolve(cwd, specifier);
}

export function resolveFileLikeImageSpecifierToFileUrl(
    specifier: string,
    cwd: string = process.cwd()
): string {
    if (specifier.startsWith('file://')) {
        return specifier;
    }

    const filePath = resolveFileLikeImageSpecifierToPath(specifier, cwd);
    return pathToFileURL(filePath).href;
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
