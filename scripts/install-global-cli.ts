#!/usr/bin/env tsx

/**
 * Manage global dexto development installs.
 *
 * Modes:
 * - install: build the current-platform standalone artifact and install it like the native CLI
 * - link: pnpm-link the workspace CLI globally after removing native/global installs
 * - unlink: remove native/global installs without linking anything back
 */
import { execFileSync } from 'child_process';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { delimiter, dirname, join, resolve } from 'path';
import {
    getDefaultNativeBinaryPath,
    getDextoHomePath,
    readInstallMetadata,
    removePath,
    type InstallMetadata,
} from '../packages/cli/src/cli/utils/self-management.ts';

const ROOT_DIR = process.cwd();
const CLI_PACKAGE_JSON_PATH = join(ROOT_DIR, 'packages', 'cli', 'package.json');
const STANDALONE_OUTPUT_DIR = join(ROOT_DIR, '.artifacts', 'standalone');
const INSTALL_METADATA_PATH = join(getDextoHomePath(), 'install.json');
const CLI_BINARY_NAME = process.platform === 'win32' ? 'dexto.exe' : 'dexto';

type Mode = 'install' | 'link' | 'unlink';

function printUsage(): void {
    console.log(`Usage: tsx scripts/install-global-cli.ts [install|link|unlink]

Modes:
  install   Build and install the standalone CLI artifact (default)
  link      Remove existing installs, then pnpm-link packages/cli globally
  unlink    Remove native/global installs without linking anything back

Environment:
  DEXTO_INSTALL_DIR  Override the native install directory for install mode`);
}

function parseMode(argv: string[]): Mode {
    let mode: Mode = 'install';
    let sawExplicitMode = false;

    for (const arg of argv) {
        if (arg === '-h' || arg === '--help') {
            printUsage();
            process.exit(0);
        }

        if (arg === 'install' || arg === 'link' || arg === 'unlink') {
            if (sawExplicitMode) {
                throw new Error('Specify only one mode: install, link, or unlink');
            }
            sawExplicitMode = true;
            mode = arg;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return mode;
}

function ensureRepoRoot(): void {
    if (!existsSync(CLI_PACKAGE_JSON_PATH)) {
        throw new Error('Must run from repository root');
    }
}

function readCliVersion(): string {
    const raw = JSON.parse(readFileSync(CLI_PACKAGE_JSON_PATH, 'utf-8')) as {
        version?: unknown;
    };

    if (typeof raw.version !== 'string' || raw.version.length === 0) {
        throw new Error(`Could not determine CLI version from ${CLI_PACKAGE_JSON_PATH}`);
    }

    return raw.version;
}

function detectPlatformName(): 'darwin' | 'linux' | 'windows' {
    switch (process.platform) {
        case 'darwin':
            return 'darwin';
        case 'linux':
            return 'linux';
        case 'win32':
            return 'windows';
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

function detectArchName(): 'x64' | 'arm64' {
    switch (process.arch) {
        case 'x64':
            return 'x64';
        case 'arm64':
            return 'arm64';
        default:
            throw new Error(`Unsupported architecture: ${process.arch}`);
    }
}

function getArtifactPath(version: string): string {
    const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
    return join(
        STANDALONE_OUTPUT_DIR,
        `dexto-${version}-${detectPlatformName()}-${detectArchName()}.${extension}`
    );
}

function runCommand(command: string, args: string[], cwd?: string): void {
    execFileSync(command, args, {
        cwd,
        stdio: 'inherit',
    });
}

function runTextCommand(command: string, args: string[]): string {
    return execFileSync(command, args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function tryCommand(command: string, args: string[], cwd?: string): boolean {
    try {
        execFileSync(command, args, {
            cwd,
            stdio: 'ignore',
        });
        return true;
    } catch {
        return false;
    }
}

function buildStandaloneArtifact(version: string): string {
    console.log('📦 Building standalone CLI artifact...');
    mkdirSync(STANDALONE_OUTPUT_DIR, { recursive: true });

    try {
        runCommand(
            'bash',
            [
                'scripts/build-standalone-binaries.sh',
                '--version',
                version,
                '--output-dir',
                STANDALONE_OUTPUT_DIR,
                '--skip-checksums',
            ],
            ROOT_DIR
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to build standalone CLI artifact. Ensure bash is available and retry. ${message}`
        );
    }

    const artifactPath = getArtifactPath(version);
    if (!existsSync(artifactPath)) {
        throw new Error(`Expected standalone artifact was not created: ${artifactPath}`);
    }

    return artifactPath;
}

function escapePowerShellLiteral(value: string): string {
    return value.replace(/'/g, `''`);
}

function extractArtifact(artifactPath: string): { extractDir: string; binaryPath: string } {
    const extractDir = mkdtempSync(join(tmpdir(), 'dexto-install-'));

    try {
        if (artifactPath.endsWith('.tar.gz')) {
            runCommand('tar', ['-xzf', artifactPath, '-C', extractDir]);
        } else if (artifactPath.endsWith('.zip')) {
            const commandText =
                `$ErrorActionPreference = 'Stop'; ` +
                `Expand-Archive -LiteralPath '${escapePowerShellLiteral(artifactPath)}' ` +
                `-DestinationPath '${escapePowerShellLiteral(extractDir)}' -Force`;
            runCommand('powershell', [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                commandText,
            ]);
        } else {
            throw new Error(`Unsupported artifact type: ${artifactPath}`);
        }

        const binaryPath = join(extractDir, CLI_BINARY_NAME);
        if (!existsSync(binaryPath)) {
            throw new Error(`Extracted artifact is missing ${CLI_BINARY_NAME}: ${artifactPath}`);
        }

        return { extractDir, binaryPath };
    } catch (error) {
        rmSync(extractDir, { recursive: true, force: true });
        throw error;
    }
}

function resolveInstallDir(): string {
    const overrideDir = process.env.DEXTO_INSTALL_DIR?.trim();
    if (overrideDir) {
        return resolve(overrideDir);
    }

    return dirname(getDefaultNativeBinaryPath());
}

function resolveInstallPath(): string {
    return join(resolveInstallDir(), CLI_BINARY_NAME);
}

function normalizePath(targetPath: string): string {
    const normalized = resolve(targetPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isDirOnPath(targetDir: string): boolean {
    const pathValue = process.env.PATH ?? '';
    const target = normalizePath(targetDir);
    return pathValue
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .some((entry) => normalizePath(entry) === target);
}

async function removeIfPresent(targetPath: string, label: string): Promise<boolean> {
    if (!existsSync(targetPath)) {
        return false;
    }

    await removePath(targetPath);
    console.log(`  ✓ Removed ${label}: ${targetPath}`);
    return true;
}

async function cleanupNativeInstall(targetInstallPath: string): Promise<boolean> {
    const metadata = await readInstallMetadata();
    const candidates = new Set<string>([getDefaultNativeBinaryPath(), targetInstallPath]);

    if (metadata?.installedPath) {
        candidates.add(metadata.installedPath);
    }

    let removedAny = false;

    for (const candidate of candidates) {
        removedAny = (await removeIfPresent(candidate, 'native binary')) || removedAny;
    }

    removedAny = (await removeIfPresent(INSTALL_METADATA_PATH, 'install metadata')) || removedAny;

    return removedAny;
}

async function cleanupPnpmGlobalShim(): Promise<boolean> {
    try {
        const pnpmBinDir = runTextCommand('pnpm', ['bin', '-g']);
        const candidates =
            process.platform === 'win32'
                ? [
                      join(pnpmBinDir, 'dexto'),
                      join(pnpmBinDir, 'dexto.cmd'),
                      join(pnpmBinDir, 'dexto.exe'),
                  ]
                : [join(pnpmBinDir, 'dexto')];

        let removedAny = false;
        for (const candidate of candidates) {
            removedAny = (await removeIfPresent(candidate, 'pnpm shim')) || removedAny;
        }

        return removedAny;
    } catch {
        return false;
    }
}

async function cleanupExistingGlobalInstalls(targetInstallPath: string): Promise<void> {
    console.log('🧹 Cleaning existing global dexto installs...');

    // Legacy/global package-manager installs.
    tryCommand('npm', ['uninstall', '-g', 'dexto']);
    tryCommand('pnpm', ['unlink', '--global', 'dexto']);
    tryCommand('pnpm', ['remove', '--global', 'dexto']);
    tryCommand('bun', ['remove', '-g', 'dexto']);

    const removedNative = await cleanupNativeInstall(targetInstallPath);
    const removedPnpmShim = await cleanupPnpmGlobalShim();

    if (!removedNative && !removedPnpmShim) {
        console.log('  (no native binaries or shims needed cleanup)');
    }
}

function createInstallMetadata(installedPath: string, version: string): InstallMetadata {
    return {
        schemaVersion: 1,
        method: 'native',
        installedPath,
        installedAt: new Date().toISOString(),
        version,
        platform: detectPlatformName(),
        arch: detectArchName(),
    };
}

function writeInstallMetadata(metadata: InstallMetadata): void {
    mkdirSync(getDextoHomePath(), { recursive: true });
    writeFileSync(INSTALL_METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}

function verifyInstalledBinary(binaryPath: string, expectedVersion: string): void {
    const version = runTextCommand(binaryPath, ['--version']).replace(/\r?\n/g, '').trim();
    if (version !== expectedVersion) {
        throw new Error(
            `Installed CLI version mismatch. Expected ${expectedVersion}, got ${version}`
        );
    }
}

async function installStandaloneCli(version: string): Promise<void> {
    const artifactPath = buildStandaloneArtifact(version);
    const { extractDir, binaryPath } = extractArtifact(artifactPath);
    const installDir = resolveInstallDir();
    const installPath = resolveInstallPath();

    try {
        await cleanupExistingGlobalInstalls(installPath);

        console.log(`📥 Installing standalone CLI to ${installPath}...`);
        mkdirSync(installDir, { recursive: true });
        copyFileSync(binaryPath, installPath);
        if (process.platform !== 'win32') {
            chmodSync(installPath, 0o755);
        }

        writeInstallMetadata(createInstallMetadata(installPath, version));
        verifyInstalledBinary(installPath, version);

        console.log('');
        console.log(`✅ Installed standalone dexto ${version}`);
        console.log(`   Binary: ${installPath}`);
        console.log(`   Artifact: ${artifactPath}`);

        if (!isDirOnPath(installDir)) {
            console.warn(`⚠️  ${installDir} is not currently on PATH.`);
            console.warn(`   Add it to PATH or run the binary directly from ${installPath}.`);
        }
    } finally {
        rmSync(extractDir, { recursive: true, force: true });
    }
}

async function linkWorkspaceCli(): Promise<void> {
    await cleanupExistingGlobalInstalls(resolveInstallPath());

    console.log('🔗 Linking packages/cli globally with pnpm...');
    runCommand('pnpm', ['link', '--global'], join(ROOT_DIR, 'packages', 'cli'));

    console.log('');
    console.log('✅ Linked workspace CLI globally');
    console.log(`   Source: ${join(ROOT_DIR, 'packages', 'cli')}`);
}

async function unlinkGlobalCli(): Promise<void> {
    await cleanupExistingGlobalInstalls(resolveInstallPath());

    console.log('');
    console.log('✅ Removed global dexto installs');
}

async function main(): Promise<void> {
    ensureRepoRoot();

    const mode = parseMode(process.argv.slice(2));

    switch (mode) {
        case 'install':
            await installStandaloneCli(readCliVersion());
            break;
        case 'link':
            await linkWorkspaceCli();
            break;
        case 'unlink':
            await unlinkGlobalCli();
            break;
        default: {
            const exhaustiveMode: never = mode;
            throw new Error(`Unhandled mode: ${String(exhaustiveMode)}`);
        }
    }
}

main().catch((error: unknown) => {
    console.error('❌ Global CLI workflow failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
