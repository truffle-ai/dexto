import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    realpathSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    mkdtempSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { isPublished } from './cli-beta-registry.mjs';

const destination = resolve(process.argv[2]);
mkdirSync(destination, { recursive: true });
const entries = readFileSync('scripts/cli-beta-packages.txt', 'utf8').trim().split('\n');
const packed = new Map();
for (const entry of entries) {
    const [dir] = entry.split(':');
    const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    assert.match(pkg.version, /-beta\.\d+$/);
    assert.equal(
        await isPublished(pkg.name, pkg.version),
        false,
        `${pkg.name}@${pkg.version} already published`
    );
    const result = JSON.parse(
        execFileSync('pnpm', ['--dir', dir, 'pack', '--json', '--pack-destination', destination], {
            encoding: 'utf8',
        })
    );
    const tarball = resolve(result.filename);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json']));
    assert.equal(
        JSON.stringify(manifest).includes('workspace:'),
        false,
        `${pkg.name}: workspace reference`
    );
    assert.equal(manifest.version, pkg.version);
    packed.set(pkg.name, { manifest, tarball });
}
for (const { manifest } of packed.values()) {
    for (const [name, version] of Object.entries({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
    })) {
        if (!name.startsWith('@dexto/')) continue;
        if (packed.has(name)) assert.equal(version, packed.get(name).manifest.version);
        else
            assert.equal(
                await isPublished(name, version),
                true,
                `Unavailable internal dependency ${name}@${version}`
            );
    }
}
writeFileSync(
    join(destination, 'SHA256SUMS'),
    [...packed.values()]
        .map(
            ({ tarball }) =>
                `${createHash('sha256').update(readFileSync(tarball)).digest('hex')}  ${tarball.split('/').at(-1)}`
        )
        .join('\n') + '\n'
);
const registry = spawn(
    process.execPath,
    ['scripts/test-beta-registry.mjs', ...[...packed.values()].map(({ tarball }) => tarball)],
    { stdio: ['ignore', 'pipe', 'inherit'] }
);
try {
    await new Promise((done, reject) => {
        registry.stdout.once('data', done);
        registry.once('error', reject);
        registry.once('exit', (code) => reject(new Error(`Registry exited: ${code}`)));
    });
    const project = mkdtempSync(join(tmpdir(), 'cli-beta-install-'));
    writeFileSync(
        join(project, 'package.json'),
        JSON.stringify({
            private: true,
            packageManager: JSON.parse(readFileSync('package.json', 'utf8')).packageManager,
            pnpm: { onlyBuiltDependencies: ['better-sqlite3', 'esbuild'] },
        })
    );
    // Keep the fixture event loop responsive while the package manager resolves tarballs.
    await new Promise((done, reject) => {
        const install = spawn(
            'pnpm',
            ['add', packed.get('dexto').tarball, '--registry=http://127.0.0.1:4873'],
            { cwd: project, stdio: 'inherit' }
        );
        install.once('error', reject);
        install.once('exit', (code) =>
            code === 0 ? done() : reject(new Error(`Empty-project install exited ${code}`))
        );
    });
    execFileSync(join(project, 'node_modules/.bin/dexto'), ['--version'], { stdio: 'inherit' });
    execFileSync(join(project, 'node_modules/.bin/dexto'), ['--help'], { stdio: 'ignore' });
    const runtime = join(
        realpathSync(join(project, 'node_modules/dexto')),
        'beta-install-check.mjs'
    );
    copyFileSync('scripts/test-beta-runtime.mjs', runtime);
    execFileSync(process.execPath, [runtime], { stdio: 'inherit' });
    console.log(
        `PASS: ${packed.size} exact beta tarballs, internal closure, checksums and empty-project install`
    );
} finally {
    registry.kill();
}
