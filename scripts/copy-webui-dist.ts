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

        // Also ensure each standalone server directory has its own .next and public
        // Some Next.js versions place server.js under nested paths (e.g., Projects/dexto/...)
        // and expect distDir './.next' and './public' relative to that directory.
        const serverFiles = await (async () => {
            try {
                const files: string[] = [];
                const walk = async (dir: string, depth: number = 0) => {
                    if (depth > 6) return;
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const full = path.join(dir, e.name);
                        if (e.isDirectory()) await walk(full, depth + 1);
                        else if (e.isFile() && e.name === 'server.js') files.push(full);
                    }
                };
                await walk(standaloneRoot);
                return files;
            } catch {
                return [];
            }
        })();

        const manifestFiles = [
            'BUILD_ID',
            'build-manifest.json',
            'react-loadable-manifest.json',
            'routes-manifest.json',
            'app-build-manifest.json',
            'app-path-routes-manifest.json',
            'required-server-files.json',
            'package.json',
        ];

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
            // Copy key manifest files into each server's .next
            for (const mf of manifestFiles) {
                const src = path.join(sourceWebUIDir, '.next', mf);
                const dest = path.join(serverNextDir, mf);
                if (fs.existsSync(src)) {
                    await fs.copy(src, dest);
                }
            }
            console.log(`✅ Synchronized assets/manifests for server at: ${serverDir}`);
        }

        // Create a simple server.js file in the target directory for starting the app
        const serverContent = `#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve Next.js standalone server path across Next versions/layouts
const standaloneRoot = path.join(__dirname, '.next', 'standalone');
const candidates = [
  path.join(standaloneRoot, 'server.js'),
  path.join(standaloneRoot, 'src', 'app', 'webui', 'server.js'),
];

let standaloneServer = candidates.find((p) => fs.existsSync(p));

if (!standaloneServer && fs.existsSync(standaloneRoot)) {
  const preferredSuffix = path.join('src', 'app', 'webui', 'server.js');
  function findServer(dir, depth = 0) {
    if (depth > 6) return null;
    let fallback = null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const res = findServer(full, depth + 1);
          if (res) return res;
        } else if (e.isFile()) {
          if (full.endsWith(preferredSuffix)) return full;
          if (!fallback && e.name === 'server.js') fallback = full;
        }
      }
    } catch {}
    return fallback;
  }
  standaloneServer = findServer(standaloneRoot);
}

if (!standaloneServer) {
  console.error('Dexto WebUI standalone server not found. Tried:');
  for (const c of candidates) console.error('  -', c);
  console.error('Searched recursively under:', standaloneRoot);
  console.error('Please rebuild: npm run build (which builds the WebUI).');
  process.exit(1);
}

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
