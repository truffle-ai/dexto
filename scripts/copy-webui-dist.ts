// Script to copy built webui files to dist
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const rootDir: string = path.resolve(__dirname, '..');

// Define source and target paths
const sourceWebUIDir: string = path.join(rootDir, 'packages', 'webui');
// Copy into CLI's dist folder for embedding
const targetDir: string = path.join(rootDir, 'packages', 'cli', 'dist', 'webui');

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

        // Copy standalone build files and necessary config. The root `.next` already
        // contains both `standalone` and `static`, so avoid re-copying nested paths
        // that can introduce symlink/self-reference errors during fs copy.
        const filesToCopy = ['.next', 'public', 'package.json'];

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

        // Copy the static files to the correct location(s) in standalone
        const staticSrcPath = path.join(sourceWebUIDir, '.next', 'static');
        const standaloneRoot = path.join(targetDir, '.next', 'standalone');
        const staticDestPath = path.join(standaloneRoot, '.next', 'static');

        if (fs.existsSync(staticSrcPath)) {
            await fs.ensureDir(path.dirname(staticDestPath));
            await fs.copy(staticSrcPath, staticDestPath);
            console.log('✅ Copied static files to standalone root location');
        }

        // Copy public files to standalone root
        const publicSrcPath = path.join(sourceWebUIDir, 'public');
        const publicDestPath = path.join(standaloneRoot, 'public');

        if (fs.existsSync(publicSrcPath)) {
            await fs.copy(publicSrcPath, publicDestPath);
            console.log('✅ Copied public files to standalone root');
        }

        // Ensure each known standalone server directory has its own .next and public.
        const candidateServers = [
            path.join(standaloneRoot, 'server.js'),
            path.join(standaloneRoot, 'cli', 'src', 'webui', 'server.js'),
            path.join(standaloneRoot, 'webui', 'server.js'),
            path.join(standaloneRoot, 'packages', 'webui', 'server.js'),
        ];
        const serverFiles = candidateServers.filter((p) => fs.existsSync(p));

        for (const serverFile of serverFiles) {
            const serverDir = path.dirname(serverFile);
            const serverNextDir = path.join(serverDir, '.next');
            const serverPublicDir = path.join(serverDir, 'public');

            if (fs.existsSync(staticSrcPath)) {
                await fs.ensureDir(serverNextDir);
                await fs.copy(staticSrcPath, path.join(serverNextDir, 'static'));
            }
            if (fs.existsSync(publicSrcPath)) {
                await fs.copy(publicSrcPath, serverPublicDir);
            }
            console.log(`✅ Synchronized static/public for server at: ${serverDir}`);
        }

        // Create a simple server.js file in the target directory for starting the app
        const serverContent = `#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve Next.js standalone server path across Next versions/layouts
const standaloneRoot = path.join(__dirname, '.next', 'standalone');
const candidates = [
  path.join(standaloneRoot, 'server.js'),
  path.join(standaloneRoot, 'cli', 'src', 'webui', 'server.js'),
  path.join(standaloneRoot, 'webui', 'server.js'),
  path.join(standaloneRoot, 'packages', 'webui', 'server.js'),
];
const standaloneServer = candidates.find((p) => fs.existsSync(p));

let childProcess = null;

if (standaloneServer) {
  console.log('Starting Dexto WebUI server...');
  childProcess = spawn(process.execPath, [standaloneServer], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
      PORT: process.env.FRONTEND_PORT || process.env.PORT || '3000',
    },
  });
} else {
  // Fallback A: resolve Next CLI robustly and serve embedded .next
  let cliNext;
  try {
    cliNext = require.resolve('next/dist/bin/next');
  } catch {
    try {
      cliNext = require.resolve('next/dist/bin/next', {
        paths: [path.join(__dirname, '..', '..', '..')],
      });
    } catch {}
  }

  if (cliNext && fs.existsSync(path.join(__dirname, '.next'))) {
    console.warn('Standalone bundle missing. Using Next CLI to serve embedded .next ...');
    childProcess = spawn(process.execPath, [cliNext, 'start'], {
      cwd: __dirname,
      stdio: 'inherit',
      env: {
        ...process.env,
        HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
        PORT: process.env.FRONTEND_PORT || process.env.PORT || '3000',
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
    });
  } else {
    console.error('Dexto WebUI standalone server not found. Tried:');
    for (const candidate of candidates) console.error('  -', candidate);
    console.error('Please rebuild: pnpm run build (which builds the WebUI).');
    process.exit(1);
  }
}

if (!childProcess) {
  console.error('Unable to start Dexto WebUI server process.');
  process.exit(1);
}

childProcess.on('exit', (code) => process.exit(code ?? 0));
childProcess.on('error', (err) => {
  console.error('Failed to start Next.js server:', err);
  process.exit(1);
});

const forwardSignal = (signal) => {
  if (!childProcess || childProcess.killed) return;
  childProcess.kill(signal);
};

process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGINT', () => forwardSignal('SIGINT'));
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
