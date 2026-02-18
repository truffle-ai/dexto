#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';

type BuildTarget = {
    packageName: string;
    bunTarget: string;
    exeName: string;
};

const ALL_TARGETS: BuildTarget[] = [
    {
        packageName: 'dexto-darwin-arm64',
        bunTarget: 'bun-darwin-arm64',
        exeName: 'dexto',
    },
    {
        packageName: 'dexto-darwin-x64',
        bunTarget: 'bun-darwin-x64-baseline',
        exeName: 'dexto',
    },
    {
        packageName: 'dexto-linux-arm64',
        bunTarget: 'bun-linux-arm64',
        exeName: 'dexto',
    },
    {
        packageName: 'dexto-linux-arm64-musl',
        bunTarget: 'bun-linux-arm64-musl',
        exeName: 'dexto',
    },
    {
        packageName: 'dexto-linux-x64',
        bunTarget: 'bun-linux-x64-baseline',
        exeName: 'dexto',
    },
    {
        packageName: 'dexto-linux-x64-musl',
        bunTarget: 'bun-linux-x64-baseline-musl',
        exeName: 'dexto',
    },
    {
        packageName: 'dexto-win32-x64',
        bunTarget: 'bun-windows-x64-baseline',
        exeName: 'dexto.exe',
    },
];

function readJsonFile(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getDextoCliVersion(rootDir: string): string {
    const wrapperPkgJsonPath = path.join(rootDir, 'packages', 'dexto', 'package.json');
    if (!fs.existsSync(wrapperPkgJsonPath)) {
        throw new Error(
            `Missing wrapper package.json: ${path.relative(rootDir, wrapperPkgJsonPath)}`
        );
    }

    const raw = readJsonFile(wrapperPkgJsonPath);
    if (!raw || typeof raw !== 'object') {
        throw new Error(`Invalid JSON: ${path.relative(rootDir, wrapperPkgJsonPath)}`);
    }

    const version = (raw as { version?: unknown }).version;
    if (typeof version !== 'string' || version.length === 0) {
        throw new Error(`Missing version in: ${path.relative(rootDir, wrapperPkgJsonPath)}`);
    }

    return version;
}

function usage(): string {
    return [
        'Usage:',
        '  bun scripts/build-cli-binaries.ts [--single]',
        '',
        'Flags:',
        '  --single   Build only the current platform/arch binary package',
        '',
        'Notes:',
        '  - Requires `bun run build` first (expects packages/cli/dist to exist).',
        '  - Copies required runtime assets (agents/webui/cli assets) into each binary package under ./dist.',
        '',
    ].join('\n');
}

function isMusl(): boolean {
    if (process.platform !== 'linux') return false;

    try {
        if (fs.existsSync('/etc/alpine-release')) return true;
    } catch {
        // ignore
    }

    try {
        const res = Bun.spawnSync(['ldd', '--version'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const text = `${res.stdout.toString()}${res.stderr.toString()}`.toLowerCase();
        return text.includes('musl');
    } catch {
        return false;
    }
}

function pickSingleTarget(): BuildTarget {
    const platform = process.platform;
    const arch = process.arch;
    const musl = isMusl();

    const pkgName = (() => {
        if (platform === 'darwin' && arch === 'arm64') return 'dexto-darwin-arm64';
        if (platform === 'darwin' && arch === 'x64') return 'dexto-darwin-x64';
        if (platform === 'linux' && arch === 'arm64')
            return musl ? 'dexto-linux-arm64-musl' : 'dexto-linux-arm64';
        if (platform === 'linux' && arch === 'x64')
            return musl ? 'dexto-linux-x64-musl' : 'dexto-linux-x64';
        if (platform === 'win32' && arch === 'x64') return 'dexto-win32-x64';
        return null;
    })();

    const target = pkgName ? ALL_TARGETS.find((t) => t.packageName === pkgName) : undefined;
    if (!target) {
        throw new Error(`Unsupported platform/arch for --single: ${platform}/${arch}`);
    }
    return target;
}

function rmrf(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;
    fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyDir(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
}

async function buildOne(
    entry: string,
    rootDir: string,
    target: BuildTarget,
    version: string
): Promise<void> {
    const pkgDir = path.join(rootDir, 'packages', target.packageName);
    const pkgJson = path.join(pkgDir, 'package.json');

    if (!fs.existsSync(pkgJson)) {
        throw new Error(`Missing binary package: ${path.relative(rootDir, pkgJson)}`);
    }

    const outBinDir = path.join(pkgDir, 'bin');
    const outDistDir = path.join(pkgDir, 'dist');
    rmrf(outBinDir);
    rmrf(outDistDir);
    fs.mkdirSync(outBinDir, { recursive: true });

    const outfile = path.join(outBinDir, target.exeName);
    const defineVersionArg = `DEXTO_CLI_VERSION:${JSON.stringify(version)}`;

    console.log(`🔧 Building ${target.packageName} (${target.bunTarget})...`);
    const res =
        await $`bun build --compile --target=${target.bunTarget} --outfile=${outfile} --no-compile-autoload-dotenv --no-compile-autoload-bunfig --define ${defineVersionArg} ${entry}`.nothrow();
    if (res.exitCode !== 0) {
        throw new Error(
            `bun build failed for ${target.packageName}:\n${res.stderr.toString() || res.stdout.toString()}`
        );
    }

    // Copy runtime assets into the binary package.
    const cliDist = path.join(rootDir, 'packages', 'cli', 'dist');
    copyDir(path.join(cliDist, 'agents'), path.join(outDistDir, 'agents'));
    copyDir(path.join(cliDist, 'webui'), path.join(outDistDir, 'webui'));
    copyDir(path.join(cliDist, 'cli', 'assets'), path.join(outDistDir, 'cli', 'assets'));
}

async function main(): Promise<void> {
    const rootDir = process.cwd();
    const version = getDextoCliVersion(rootDir);

    const args = process.argv.slice(2);
    const single = args.includes('--single');
    if (args.includes('--help') || args.includes('-h')) {
        console.log(usage());
        return;
    }

    if (!fs.existsSync(path.join(rootDir, 'packages/cli/package.json'))) {
        throw new Error('Must run from repository root');
    }

    const entry = path.join(rootDir, 'packages', 'cli', 'dist', 'index.js');
    if (!fs.existsSync(entry)) {
        throw new Error(
            `Missing CLI build output: ${path.relative(rootDir, entry)}\nRun: bun run build`
        );
    }

    const targets = single ? [pickSingleTarget()] : ALL_TARGETS;

    for (const target of targets) {
        await buildOne(entry, rootDir, target, version);
    }

    console.log(`✅ Built ${targets.length} binary package(s).`);
}

main().catch((err) => {
    console.error('❌ Failed to build CLI binaries:', err);
    process.exit(1);
});
