#!/usr/bin/env node
/**
 * CLI for bundling Dexto base images
 */

import { Command } from 'commander';
import { bundle } from './bundler.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const program = new Command();

program.name('dexto-bundle').description('Bundle Dexto base images').version(packageJson.version);

program
    .command('build')
    .description('Build a base image from dexto.image.ts')
    .option('-i, --image <path>', 'Path to dexto.image.ts file', 'dexto.image.ts')
    .option('-o, --out <dir>', 'Output directory', 'dist')
    .option('--sourcemap', 'Generate source maps', false)
    .option('--minify', 'Minify output', false)
    .action(async (options) => {
        try {
            console.log(pc.cyan('🚀 Dexto Image Bundler\n'));

            const result = await bundle({
                imagePath: options.image,
                outDir: options.out,
                sourcemap: options.sourcemap,
                minify: options.minify,
            });

            console.log(pc.green('\n✨ Build successful!\n'));
            console.log(pc.bold('Image Details:'));
            console.log(`  Name:        ${result.metadata.name}`);
            console.log(`  Version:     ${result.metadata.version}`);
            console.log(`  Target:      ${result.metadata.target}`);
            console.log(`  Built at:    ${result.metadata.builtAt}`);
            console.log(`  Core:        v${result.metadata.coreVersion}`);

            if (result.metadata.constraints.length > 0) {
                console.log(`  Constraints: ${result.metadata.constraints.join(', ')}`);
            }

            if (result.warnings.length > 0) {
                console.log(pc.yellow('\n⚠️  Warnings:'));
                result.warnings.forEach((w) => console.log(`  - ${w}`));
            }

            // Read package.json to get the actual package name
            const packageJsonPath = join(process.cwd(), 'package.json');
            let packageName = result.metadata.name;
            try {
                if (readFileSync) {
                    const pkgJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
                    packageName = pkgJson.name || result.metadata.name;
                }
            } catch {
                // Use metadata name as fallback
            }

            console.log(pc.green('\n✅ Image is ready to use!'));
            console.log(
                pc.dim(
                    `   Use it: set \`image: "${packageName}"\` in your agent config, with the package installed where the agent runs`
                )
            );
        } catch (error) {
            console.error(pc.red('\n❌ Build failed:'), error);
            process.exit(1);
        }
    });

program.parse();
