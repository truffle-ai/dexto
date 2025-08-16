// Script to copy built webui files to dist
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const rootDir: string = path.resolve(__dirname, '..');

// Define source and target paths
const sourceWebUIDir: string = path.join(rootDir, 'src', 'app', 'webui');
const targetDir: string = path.join(rootDir, 'dist', 'src', 'app', 'webui');

async function copyWebUIBuild(): Promise<void> {
    try {
        // Ensure the target directory doesn't exist to avoid conflicts
        if (fs.existsSync(targetDir)) {
            console.log('Removing existing target directory...');
            await fs.remove(targetDir);
        }

        console.log(`Copying built webui from ${sourceWebUIDir} to ${targetDir}...`);

        // Create target directory
        await fs.ensureDir(targetDir);

        // Copy standalone build files and necessary config
        const filesToCopy = ['.next/standalone', '.next/static', 'public', 'package.json'];

        for (const file of filesToCopy) {
            const srcPath = path.join(sourceWebUIDir, file);
            const destPath = path.join(targetDir, file);

            if (fs.existsSync(srcPath)) {
                await fs.copy(srcPath, destPath);
                console.log(`✅ Copied ${file}`);
            } else {
                console.log(`⚠️  ${file} not found, skipping`);
            }
        }

        // Copy the static files to the correct location in standalone
        const staticSrcPath = path.join(sourceWebUIDir, '.next', 'static');
        const staticDestPath = path.join(targetDir, '.next', 'standalone', '.next', 'static');

        if (fs.existsSync(staticSrcPath)) {
            await fs.ensureDir(path.dirname(staticDestPath));
            await fs.copy(staticSrcPath, staticDestPath);
            console.log('✅ Copied static files to standalone location');
        }

        // Copy public files to standalone location
        const publicSrcPath = path.join(sourceWebUIDir, 'public');
        const publicDestPath = path.join(targetDir, '.next', 'standalone', 'public');

        if (fs.existsSync(publicSrcPath)) {
            await fs.copy(publicSrcPath, publicDestPath);
            console.log('✅ Copied public files to standalone location');
        }

        // Create a simple server.js file in the target directory for starting the app
        const serverContent = `#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

// Start the standalone Next.js server
const standaloneServer = path.join(__dirname, '.next', 'standalone', 'server.js');

console.log('Starting Dexto WebUI server...');

const server = spawn('node', [standaloneServer], {
    stdio: 'inherit',
    env: {
        ...process.env,
        HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
        PORT: process.env.FRONTEND_PORT || process.env.PORT || '3000',
    },
});

server.on('error', (err) => {
    console.error('Failed to start Next.js server:', err);
    process.exit(1);
});

process.on('SIGTERM', () => {
    server.kill('SIGTERM');
});

process.on('SIGINT', () => {
    server.kill('SIGINT');
});
`;

        await fs.writeFile(path.join(targetDir, 'server.js'), serverContent);
        await fs.chmod(path.join(targetDir, 'server.js'), '755');
        console.log('✅ Created server.js startup script');

        console.log('✅ Successfully copied built webui to dist');
    } catch (err: unknown) {
        console.error('❌ Error copying built webui:', err);
        process.exit(1);
    }
}

// Execute the copy function
copyWebUIBuild();
