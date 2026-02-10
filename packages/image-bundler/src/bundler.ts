/**
 * Main bundler logic
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateImageDefinition } from './image-definition/validate-image-definition.js';
import type { ImageDefinition } from './image-definition/types.js';
import type { BundleOptions, BundleResult } from './types.js';
import { generateEntryPoint } from './generator.js';
import ts from 'typescript';

/**
 * Bundle a Dexto base image
 */
export async function bundle(options: BundleOptions): Promise<BundleResult> {
    const warnings: string[] = [];

    // 1. Load and validate image definition
    console.log(`📦 Loading image definition from ${options.imagePath}`);
    const definition = await loadImageDefinition(options.imagePath);

    console.log(`✅ Loaded image: ${definition.name} v${definition.version}`);

    // 2. Validate definition
    console.log(`🔍 Validating image definition...`);
    try {
        validateImageDefinition(definition);
        console.log(`✅ Image definition is valid`);
    } catch (error) {
        throw new Error(`Image validation failed: ${error}`);
    }

    // 3. Get core version (from package.json)
    const coreVersion = getCoreVersion();

    // 3.5. Discover providers from convention-based folders
    console.log(`🔍 Discovering providers from folders...`);
    const imageDir = dirname(options.imagePath);
    const discoveredProviders = discoverProviders(imageDir);
    console.log(`✅ Discovered ${discoveredProviders.totalCount} provider(s)`);

    // 4. Generate code
    console.log(`🔨 Generating entry point...`);
    const generated = generateEntryPoint(definition, coreVersion, discoveredProviders);

    // 5. Ensure output directory exists
    const outDir = resolve(options.outDir);
    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    // 5.5. Compile provider category folders
    console.log(`🔨 Compiling provider source files...`);
    const categories = ['blob-store', 'tools', 'compaction', 'plugins'];
    let compiledCount = 0;

    for (const category of categories) {
        const categoryDir = join(imageDir, category);
        if (existsSync(categoryDir)) {
            compileSourceFiles(categoryDir, join(outDir, category));
            compiledCount++;
        }
    }

    if (compiledCount > 0) {
        console.log(
            `✅ Compiled ${compiledCount} provider categor${compiledCount === 1 ? 'y' : 'ies'}`
        );
    }

    // 6. Write generated files
    const entryFile = join(outDir, 'index.js');
    const typesFile = join(outDir, 'index.d.ts');

    console.log(`📝 Writing ${entryFile}...`);
    writeFileSync(entryFile, generated.js, 'utf-8');

    console.log(`📝 Writing ${typesFile}...`);
    writeFileSync(typesFile, generated.dts, 'utf-8');

    // 7. Generate package.json exports
    updatePackageJson(dirname(options.imagePath), outDir);

    console.log(`✨ Build complete!`);
    console.log(`   Entry: ${entryFile}`);
    console.log(`   Types: ${typesFile}`);

    const metadata = {
        name: definition.name,
        version: definition.version,
        description: definition.description,
        target: definition.target || 'custom',
        constraints: definition.constraints || [],
        builtAt: new Date().toISOString(),
        coreVersion,
    };

    return {
        entryFile,
        typesFile,
        metadata,
        warnings,
    };
}

/**
 * Load image definition from file
 */
async function loadImageDefinition(imagePath: string): Promise<ImageDefinition> {
    const absolutePath = resolve(imagePath);

    if (!existsSync(absolutePath)) {
        throw new Error(`Image file not found: ${absolutePath}`);
    }

    try {
        // Convert to file:// URL for ESM import
        const fileUrl = pathToFileURL(absolutePath).href;

        // Dynamic import
        const module = await import(fileUrl);

        // Get default export
        const definition = module.default as ImageDefinition;

        if (!definition) {
            throw new Error('Image file must have a default export');
        }

        return definition;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to load image definition: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Get @dexto/core version
 */
function getCoreVersion(): string {
    try {
        // Try to read from node_modules
        const corePackageJson = join(process.cwd(), 'node_modules/@dexto/core/package.json');
        if (existsSync(corePackageJson)) {
            const pkg = JSON.parse(readFileSync(corePackageJson, 'utf-8'));
            return pkg.version;
        }

        // Fallback to workspace version
        return '1.0.0';
    } catch {
        return '1.0.0';
    }
}

/**
 * Update or create package.json with proper exports
 */
function updatePackageJson(imageDir: string, outDir: string): void {
    const packageJsonPath = join(imageDir, 'package.json');

    if (!existsSync(packageJsonPath)) {
        console.log(`⚠️  No package.json found, skipping exports update`);
        return;
    }

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        // Update exports
        pkg.exports = {
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.js',
            },
        };

        // Update main and types fields
        pkg.main = './dist/index.js';
        pkg.types = './dist/index.d.ts';

        writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2), 'utf-8');
        console.log(`✅ Updated package.json exports`);
    } catch (error) {
        console.warn(`⚠️  Failed to update package.json: ${error}`);
    }
}

/**
 * Compile TypeScript source files to JavaScript
 */
function compileSourceFiles(srcDir: string, outDir: string): void {
    // Find all .ts files
    const tsFiles = findTypeScriptFiles(srcDir);

    if (tsFiles.length === 0) {
        console.log(`   No TypeScript files found in ${srcDir}`);
        return;
    }

    console.log(`   Found ${tsFiles.length} TypeScript file(s) to compile`);

    // TypeScript compiler options
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        outDir: outDir,
        rootDir: srcDir, // Use srcDir as root
        declaration: true,
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        resolveJsonModule: true,
    };

    // Create program
    const program = ts.createProgram(tsFiles, compilerOptions);

    // Emit compiled files
    const emitResult = program.emit();

    // Check for errors
    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

    if (allDiagnostics.length > 0) {
        allDiagnostics.forEach((diagnostic) => {
            if (diagnostic.file) {
                const { line, character } = ts.getLineAndCharacterOfPosition(
                    diagnostic.file,
                    diagnostic.start!
                );
                const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                console.error(
                    `   ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`
                );
            } else {
                console.error(
                    `   ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
                );
            }
        });

        if (emitResult.emitSkipped) {
            throw new Error('TypeScript compilation failed');
        }
    }
}

/**
 * Recursively find all TypeScript files in a directory
 */
function findTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];

    function walk(currentDir: string) {
        const entries = readdirSync(currentDir);

        for (const entry of entries) {
            const fullPath = join(currentDir, entry);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (stat.isFile() && extname(entry) === '.ts') {
                files.push(fullPath);
            }
        }
    }

    walk(dir);
    return files;
}

/**
 * Provider discovery result for a single category
 */
export interface DiscoveredProviders {
    blobStore: string[];
    customTools: string[];
    compaction: string[];
    plugins: string[];
    totalCount: number;
}

/**
 * Discover providers from convention-based folder structure
 *
 * Convention (folder-based with index.ts):
 *   tools/           - CustomToolProvider folders
 *     weather/       - Provider folder
 *       index.ts     - Provider implementation (auto-discovered)
 *       helpers.ts   - Optional helper files
 *       types.ts     - Optional type definitions
 *   blob-store/      - BlobStoreProvider folders
 *   compaction/      - CompactionProvider folders
 *   plugins/         - PluginProvider folders
 *
 * Naming Convention (Node.js standard):
 *   <folder>/index.ts    - Auto-discovered and registered
 *   <folder>/other.ts    - Ignored unless imported by index.ts
 */
function discoverProviders(imageDir: string): DiscoveredProviders {
    const result: DiscoveredProviders = {
        blobStore: [],
        customTools: [],
        compaction: [],
        plugins: [],
        totalCount: 0,
    };

    // Category mapping: folder name -> property name
    const categories = {
        'blob-store': 'blobStore',
        tools: 'customTools',
        compaction: 'compaction',
        plugins: 'plugins',
    } as const;

    for (const [folderName, propName] of Object.entries(categories)) {
        const categoryDir = join(imageDir, folderName);

        if (!existsSync(categoryDir)) {
            continue;
        }

        // Find all provider folders (those with index.ts)
        const providerFolders = readdirSync(categoryDir)
            .filter((entry) => {
                const entryPath = join(categoryDir, entry);
                const stat = statSync(entryPath);

                // Must be a directory
                if (!stat.isDirectory()) {
                    return false;
                }

                // Must contain index.ts
                const indexPath = join(entryPath, 'index.ts');
                return existsSync(indexPath);
            })
            .map((folder) => {
                // Return relative path for imports
                return `./${folderName}/${folder}/index.js`;
            });

        if (providerFolders.length > 0) {
            result[propName as keyof Omit<DiscoveredProviders, 'totalCount'>].push(
                ...providerFolders
            );
            result.totalCount += providerFolders.length;
            console.log(`   Found ${providerFolders.length} provider(s) in ${folderName}/`);
        }
    }

    return result;
}
