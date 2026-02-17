// Script to copy built Vite webui files to CLI dist
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const rootDir: string = path.resolve(__dirname, '..');

// Define source and target paths
// Vite outputs to packages/webui/dist
const sourceWebUIDir: string = path.join(rootDir, 'packages', 'webui', 'dist');
// Copy into CLI's dist folder for embedding
const targetDir: string = path.join(rootDir, 'packages', 'cli', 'dist', 'webui');

async function copyWebUIBuild(): Promise<void> {
    try {
        // Check if source directory exists
        if (!fs.existsSync(sourceWebUIDir)) {
            console.log('⚠️  WebUI dist not found. Run "bun run build:webui" first.');
            console.log(`   Expected path: ${sourceWebUIDir}`);
            process.exit(1);
        }

        // Ensure the target directory doesn't exist to avoid conflicts
        if (fs.existsSync(targetDir)) {
            console.log('Removing existing target directory...');
            await fs.remove(targetDir);
        }

        console.log(`Copying built webui from ${sourceWebUIDir} to ${targetDir}...`);

        // Copy the entire Vite dist folder
        await fs.copy(sourceWebUIDir, targetDir);

        console.log('✅ Successfully copied built webui to dist');
        console.log(`   Source: ${sourceWebUIDir}`);
        console.log(`   Target: ${targetDir}`);
    } catch (err: unknown) {
        console.error('❌ Error copying built webui:', err);
        process.exit(1);
    }
}

// Execute the copy function
copyWebUIBuild();
