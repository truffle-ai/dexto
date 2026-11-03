import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readlinkSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    detectInstallMethodWithDeps,
    readInstallMetadata,
} from '../packages/cli/src/cli/utils/self-management.js';

const INSTALLER = path.join(__dirname, 'install.sh');
// CI runs this suite under each shell `curl | sh` can land in: dash, bash, busybox ash, macOS sh.
const SHELL = process.env.DEXTO_INSTALL_TEST_SHELL ?? '/bin/sh';
const posixOnly = process.platform === 'win32' ? describe.skip : describe;

// A stand-in for npm that serves fake dexto tarballs from a local directory and logs each call.
const STUB_NPM = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const registry = process.env.STUB_REGISTRY;
fs.appendFileSync(path.join(registry, 'calls.log'), process.argv.slice(2).join(' ') + '\\n');
const [command, ...args] = process.argv.slice(2);
const tags = JSON.parse(fs.readFileSync(path.join(registry, 'tags.json'), 'utf8'));
const resolve = (spec) => {
    const wanted = spec.replace(/^dexto@/, '');
    const version = tags[wanted] ?? wanted;
    return fs.existsSync(path.join(registry, version + '.tgz')) ? version : null;
};
if (command === 'view') {
    if (process.env.STUB_VIEW_FAILS === 'network') {
        process.stderr.write('npm error code ECONNREFUSED\\n');
        process.exit(1);
    }
    if (process.env.STUB_VIEW_FAILS === '404') {
        process.stderr.write('npm error code E404\\n');
        process.exit(1);
    }
    const version = resolve(args[0]);
    if (!version) process.exit(0);
    const tarball = fs.readFileSync(path.join(registry, version + '.tgz'));
    const integrity = process.env.STUB_BAD_INTEGRITY
        ? 'sha512-' + crypto.createHash('sha512').update('tampered').digest('base64')
        : 'sha512-' + crypto.createHash('sha512').update(tarball).digest('base64');
    process.stdout.write(JSON.stringify({
        version,
        'dist.integrity': integrity,
        'dist.tarball': 'https://registry.example/dexto/-/dexto-' + version + '.tgz',
    }));
} else if (command === 'pack') {
    const version = resolve(args[0]);
    const destination = args[args.indexOf('--pack-destination') + 1];
    fs.copyFileSync(path.join(registry, version + '.tgz'), path.join(destination, 'dexto-' + version + '.tgz'));
    process.stdout.write('dexto-' + version + '.tgz\\n');
} else if (command === 'install') {
    if (process.env.STUB_INSTALL_FAILS) process.exit(1);
    const prefix = args[args.indexOf('--prefix') + 1];
    const tarball = args[args.length - 1];
    const packageDir = path.join(prefix, 'lib', 'node_modules', 'dexto');
    fs.mkdirSync(packageDir, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1']);
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    fs.symlinkSync('../lib/node_modules/dexto/bin.sh', path.join(prefix, 'bin', 'dexto'));
} else {
    process.exit(1);
}
`;

interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
    json: Record<string, Record<string, unknown>>;
}

posixOnly('scripts/install.sh', () => {
    let root: string;
    let home: string;
    let registry: string;
    let stubBin: string;

    function publish(version: string, reportedVersion: string = version): void {
        const packageDir = path.join(root, 'pkg', version, 'package');
        mkdirSync(packageDir, { recursive: true });
        writeFileSync(
            path.join(packageDir, 'bin.sh'),
            `#!/bin/sh\necho ${JSON.stringify(reportedVersion)}\n`
        );
        chmodSync(path.join(packageDir, 'bin.sh'), 0o755);
        const tar = spawnSync('tar', [
            '-czf',
            path.join(registry, `${version}.tgz`),
            '-C',
            path.dirname(packageDir),
            'package',
        ]);
        expect(tar.status).toBe(0);
    }

    function setTags(tags: Record<string, string>): void {
        writeFileSync(path.join(registry, 'tags.json'), JSON.stringify(tags));
    }

    function npmCalls(): string[] {
        const log = path.join(registry, 'calls.log');
        return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    }

    function run(
        args: string[] = [],
        env: Record<string, string> = {},
        options: { pathDirs?: string[]; viaStdin?: boolean } = {}
    ): RunResult {
        const pathDirs = options.pathDirs ?? [
            stubBin,
            path.dirname(process.execPath),
            '/usr/bin',
            '/bin',
        ];
        const fullEnv = {
            HOME: home,
            PATH: pathDirs.join(':'),
            STUB_REGISTRY: registry,
            ...env,
        };
        const result = options.viaStdin
            ? spawnSync(SHELL, ['-s', '--', ...args], {
                  env: fullEnv,
                  input: readFileSync(INSTALLER),
                  encoding: 'utf8',
              })
            : spawnSync(SHELL, [INSTALLER, ...args], { env: fullEnv, encoding: 'utf8' });
        const lines = result.stdout.trim().split('\n');
        return {
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            json: JSON.parse(lines[lines.length - 1] ?? 'null'),
        };
    }

    const linkPath = () => path.join(home, '.local', 'bin', 'dexto');
    const versionBin = (version: string) =>
        path.join(home, '.dexto', 'cli', version, 'bin', 'dexto');

    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), 'dexto-install-test-'));
        home = path.join(root, 'home');
        registry = path.join(root, 'registry');
        stubBin = path.join(root, 'stub-bin');
        mkdirSync(home);
        mkdirSync(registry);
        mkdirSync(stubBin);
        writeFileSync(path.join(stubBin, 'npm'), STUB_NPM);
        chmodSync(path.join(stubBin, 'npm'), 0o755);
        publish('2.0.0');
        publish('2.0.1');
        setTags({ latest: '2.0.0', next: '2.0.1' });
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('installs the latest release, verified, and prints one JSON line on stdout', () => {
        const result = run(['--yes']);

        expect(result.status).toBe(0);
        expect(result.stdout.trim().split('\n')).toHaveLength(1);
        expect(result.json).toEqual({
            installed: {
                action: 'installed',
                version: '2.0.0',
                previous_version: null,
                path: linkPath(),
                on_path: false,
                shadowed_by: null,
                dry_run: false,
            },
        });
        expect(readlinkSync(linkPath())).toBe(versionBin('2.0.0'));
        expect(spawnSync(linkPath(), ['--version'], { encoding: 'utf8' }).stdout.trim()).toBe(
            '2.0.0'
        );
        expect(result.stderr).toContain('Checksum verified');
        expect(result.stderr).toContain(`export PATH="${path.join(home, '.local', 'bin')}:$PATH"`);
    });

    it('writes install metadata that dexto upgrade and uninstall read as a native install', async () => {
        expect(run().status).toBe(0);

        const previousHome = process.env.HOME;
        process.env.HOME = home;
        try {
            const metadata = await readInstallMetadata();
            expect(metadata).toMatchObject({
                method: 'native',
                installedPath: linkPath(),
                version: '2.0.0',
                releaseTag: 'dexto@2.0.0',
            });

            const detection = await detectInstallMethodWithDeps({
                getPathEntries: async () => [linkPath()],
                detectNodeManager: async () => null,
            });
            expect(detection.method).toBe('native');
            expect(detection.source).toBe('metadata');
            expect(detection.installDir).toBe(path.join(home, '.local', 'bin'));
        } finally {
            process.env.HOME = previousHome;
        }
    });

    it('is a no-op when the same version is already installed', () => {
        expect(run().status).toBe(0);
        const callsAfterFirst = npmCalls().length;

        const result = run();

        expect(result.status).toBe(0);
        expect(result.json.installed).toMatchObject({
            action: 'unchanged',
            version: '2.0.0',
            previous_version: '2.0.0',
        });
        expect(
            npmCalls()
                .slice(callsAfterFirst)
                .map((call) => call.split(' ')[0])
        ).toEqual(['view']);
    });

    it('upgrades to a pinned version from DEXTO_VERSION and removes the old one', () => {
        expect(run().status).toBe(0);

        const result = run([], { DEXTO_VERSION: 'dexto@2.0.1' });

        expect(result.status).toBe(0);
        expect(result.json.installed).toMatchObject({
            action: 'upgraded',
            version: '2.0.1',
            previous_version: '2.0.0',
        });
        expect(readlinkSync(linkPath())).toBe(versionBin('2.0.1'));
        expect(readdirSync(path.join(home, '.dexto', 'cli'))).toEqual(['2.0.1']);
    });

    it('resolves dist-tags and accepts --version in both spellings', () => {
        expect(run(['--version', 'next']).json.installed).toMatchObject({ version: '2.0.1' });
        expect(run(['--version=2.0.0']).json.installed).toMatchObject({
            action: 'upgraded',
            version: '2.0.0',
        });
    });

    it('reinstalls the same version with --force or DEXTO_INSTALL_FORCE=1', () => {
        expect(run().status).toBe(0);

        expect(run(['--force']).json.installed).toMatchObject({ action: 'reinstalled' });
        expect(run([], { DEXTO_INSTALL_FORCE: '1' }).json.installed).toMatchObject({
            action: 'reinstalled',
        });
        expect(readlinkSync(linkPath())).toBe(versionBin('2.0.0'));
    });

    it('replaces a 1.x standalone binary at ~/.local/bin/dexto', () => {
        mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
        writeFileSync(linkPath(), '#!/bin/sh\necho 1.14.5\n');
        chmodSync(linkPath(), 0o755);
        mkdirSync(path.join(home, '.dexto'));
        writeFileSync(
            path.join(home, '.dexto', 'install.json'),
            JSON.stringify({
                schemaVersion: 1,
                method: 'native',
                installedPath: linkPath(),
                installedAt: '2026-01-01T00:00:00.000Z',
                version: '1.14.5',
            })
        );

        const result = run();

        expect(result.json.installed).toMatchObject({
            action: 'upgraded',
            version: '2.0.0',
            previous_version: '1.14.5',
        });
        expect(lstatSync(linkPath()).isSymbolicLink()).toBe(true);
        expect(readlinkSync(linkPath())).toBe(versionBin('2.0.0'));
    });

    it('links into DEXTO_INSTALL_DIR or --install-dir, which dexto upgrade passes', () => {
        const customDir = path.join(root, 'custom-bin');

        const result = run([], { DEXTO_INSTALL_DIR: customDir });
        expect(result.json.installed).toMatchObject({ path: path.join(customDir, 'dexto') });
        expect(readlinkSync(path.join(customDir, 'dexto'))).toBe(versionBin('2.0.0'));

        const otherDir = path.join(root, 'other-bin');
        expect(run(['--install-dir', otherDir, '--version', 'next']).json.installed).toMatchObject({
            action: 'upgraded',
            path: path.join(otherDir, 'dexto'),
        });
        expect(existsSync(path.join(customDir, 'dexto'))).toBe(false);
        expect(lstatSync(path.join(customDir, 'dexto'), { throwIfNoEntry: false })).toBeUndefined();
    });

    it('reports whether the install dir is on PATH and what shadows it', () => {
        const binDir = path.join(home, '.local', 'bin');
        const shadowDir = path.join(root, 'shadow');
        mkdirSync(shadowDir);
        writeFileSync(path.join(shadowDir, 'dexto'), '#!/bin/sh\n');
        chmodSync(path.join(shadowDir, 'dexto'), 0o755);
        const pathDirs = [stubBin, path.dirname(process.execPath), '/usr/bin', '/bin'];

        expect(run([], {}, { pathDirs: [binDir, ...pathDirs] }).json.installed).toMatchObject({
            on_path: true,
            shadowed_by: null,
        });

        const shadowed = run(['--force'], {}, { pathDirs: [shadowDir, binDir, ...pathDirs] });
        expect(shadowed.json.installed).toMatchObject({
            on_path: true,
            shadowed_by: path.join(shadowDir, 'dexto'),
        });
        expect(shadowed.stderr).toContain('comes before');
    });

    it('changes nothing with --dry-run', () => {
        const result = run(['--dry-run']);

        expect(result.status).toBe(0);
        expect(result.json.installed).toMatchObject({
            action: 'install',
            version: '2.0.0',
            dry_run: true,
        });
        expect(existsSync(path.join(home, '.dexto'))).toBe(false);
        expect(existsSync(path.join(home, '.local'))).toBe(false);
    });

    it('runs when piped into sh, as curl | sh does', () => {
        const result = run(['--yes'], {}, { viaStdin: true });

        expect(result.status).toBe(0);
        expect(result.json.installed).toMatchObject({ action: 'installed', version: '2.0.0' });
    });

    it('refuses a tarball that does not match the registry integrity', () => {
        const result = run([], { STUB_BAD_INTEGRITY: '1' });

        expect(result.status).toBe(1);
        expect(result.json.error).toMatchObject({ code: 'checksum_mismatch' });
        expect(existsSync(linkPath())).toBe(false);
        expect(existsSync(path.join(home, '.dexto', 'install.json'))).toBe(false);
        expect(readdirSync(path.join(home, '.dexto', 'cli'))).toEqual([]);
    });

    it('keeps the current install when the new one fails to install or verify', () => {
        expect(run().status).toBe(0);

        const failed = run(['--version', '2.0.1'], { STUB_INSTALL_FAILS: '1' });
        expect(failed.status).toBe(1);
        expect(failed.json.error).toMatchObject({ code: 'install_failed' });

        publish('2.0.2', 'something-else');
        const unverified = run(['--version', '2.0.2']);
        expect(unverified.status).toBe(1);
        expect(unverified.json.error).toMatchObject({ code: 'verify_failed' });

        expect(readlinkSync(linkPath())).toBe(versionBin('2.0.0'));
        expect(readdirSync(path.join(home, '.dexto', 'cli'))).toEqual(['2.0.0']);
    });

    it('fails with registry_unreachable, not version_not_found, when npm cannot reach the registry', () => {
        const result = run([], { STUB_VIEW_FAILS: 'network' });

        expect(result.status).toBe(1);
        expect(result.json.error).toMatchObject({ code: 'registry_unreachable' });
        expect(result.stderr).toContain('ECONNREFUSED');
    });

    it('exits 5 with version_not_found for an unknown version', () => {
        const result = run(['--version', '9.9.9']);

        expect(result.status).toBe(5);
        expect(result.json.error).toMatchObject({ code: 'version_not_found' });
        expect(result.json.error?.fix).toContain('npm view dexto');
        expect(run([], { STUB_VIEW_FAILS: '404' }).status).toBe(5);
    });

    it.each([
        [['--bogus'], 'Unknown option: --bogus'],
        [['--version'], '--version needs a value.'],
        [['--version', '2.0.0; rm -rf /'], 'Not a version or dist-tag'],
        [['--install-dir', 'relative/bin'], 'must be an absolute path'],
    ])('exits 2 with invalid_input for %j', (args, message) => {
        const result = run(args);

        expect(result.status).toBe(2);
        expect(result.json.error).toMatchObject({ code: 'invalid_input' });
        expect(result.json.error?.message).toContain(message);
        expect(npmCalls()).toEqual([]);
    });

    it('fails with node_too_old on Node.js older than 20', () => {
        writeFileSync(
            path.join(stubBin, 'node'),
            `#!/bin/sh\nif [ "$1" = "-p" ]; then echo 18.19.0; exit 0; fi\nexec ${JSON.stringify(process.execPath)} "$@"\n`
        );
        chmodSync(path.join(stubBin, 'node'), 0o755);

        const result = run();

        expect(result.status).toBe(1);
        expect(result.json.error).toMatchObject({ code: 'node_too_old' });
        expect(result.json.error?.message).toContain('found 18.19.0');
    });

    it('fails with node_missing when node is not on PATH', () => {
        const toolsDir = path.join(root, 'tools');
        mkdirSync(toolsDir);
        for (const tool of ['sed', 'tr', 'uname', 'rm']) {
            const located = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
            symlinkSync(located.stdout.trim(), path.join(toolsDir, tool));
        }

        const result = run([], {}, { pathDirs: [toolsDir] });

        expect(result.status).toBe(1);
        expect(result.json.error).toMatchObject({ code: 'node_missing' });
        expect(result.json.error?.fix).toContain('nodejs.org');
    });

    it('prints help without installing', () => {
        const result = spawnSync(SHELL, [INSTALLER, '--help'], { encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('DEXTO_VERSION');
        expect(result.stdout).toContain('curl -fsSL https://dexto.ai/install | sh');
    });

    it('installs the tarball it verified, not a fresh download by name', () => {
        run();

        const install = npmCalls().find((call) => call.startsWith('install '));
        const tarballArg = install?.split(' ').pop() ?? '';
        expect(tarballArg).toMatch(/\/\.dexto\/cli\/\.download\.[^/]+\/dexto-2\.0\.0\.tgz$/);
        expect(install).toContain('--global --prefix');
        expect(existsSync(tarballArg)).toBe(false);
    });
});
