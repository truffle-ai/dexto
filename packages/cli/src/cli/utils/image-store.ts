import {
    getDefaultImageStoreDir,
    isFileLikeImageSpecifier,
    parseImageSpecifier,
    resolveFileLikeImageSpecifierToFileUrl,
    resolveImageEntryFileFromStore,
} from '@dexto/agent-management';

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
        throw new Error(`Failed to import image '${imageName}': ${message}`);
    }
}
