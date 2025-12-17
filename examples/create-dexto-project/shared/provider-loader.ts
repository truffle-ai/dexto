/**
 * Provider Auto-Discovery Utility
 *
 * This helper automatically discovers and registers providers from convention-based folders.
 * It follows the same pattern as the @dexto/bundler but at runtime.
 *
 * Convention:
 *   storage/supabase/index.ts      -> Auto-discovered and registered
 *   tools/datetime/index.ts        -> Auto-discovered and registered
 *   compression/<folder>/index.ts  -> Auto-discovered and registered
 *   plugins/<folder>/index.ts      -> Auto-discovered and registered
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BaseRegistry } from '@dexto/core';

/**
 * Discover and register all providers from a category folder
 *
 * @param categoryPath - Relative path to category folder (e.g., './storage')
 * @param registry - The registry to register providers to
 */
export async function registerProvidersFromFolder(
    categoryPath: string,
    registry: BaseRegistry<any>
): Promise<void> {
    // Resolve absolute path from the caller's location
    const currentDir = dirname(new URL(import.meta.url).pathname);
    const absolutePath = join(currentDir, '..', categoryPath);

    if (!existsSync(absolutePath)) {
        return;
    }

    // Find all provider folders (those with index.ts or index.js)
    const providerFolders = readdirSync(absolutePath).filter((entry) => {
        const entryPath = join(absolutePath, entry);
        const stat = statSync(entryPath);

        // Must be a directory
        if (!stat.isDirectory()) {
            return false;
        }

        // Must contain index.ts or index.js
        const indexTs = join(entryPath, 'index.ts');
        const indexJs = join(entryPath, 'index.js');
        return existsSync(indexTs) || existsSync(indexJs);
    });

    // Import and register each provider
    for (const folder of providerFolders) {
        const indexPath = join(absolutePath, folder, 'index.js');
        const fileUrl = pathToFileURL(indexPath).href;

        try {
            const module = await import(fileUrl);

            // Look for provider exports (objects with type and create properties)
            for (const exported of Object.values(module)) {
                if (
                    exported &&
                    typeof exported === 'object' &&
                    'type' in exported &&
                    'create' in exported
                ) {
                    registry.register(exported as any);
                    console.log(
                        `✓ Registered ${categoryPath}/${folder}: ${(exported as any).type}`
                    );
                }
            }
        } catch (error) {
            console.warn(`⚠️  Failed to load ${categoryPath}/${folder}:`, error);
        }
    }
}
