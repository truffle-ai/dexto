import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const DEXTO_BINARY = process.platform === 'win32' ? 'dexto.exe' : 'dexto';
const DEXTO_PATH_COMMAND = process.platform === 'win32' ? 'where' : 'which';
const DEXTO_PATH_ARGS = process.platform === 'win32' ? ['dexto'] : ['-a', 'dexto'];
const DEFAULT_NATIVE_INSTALL_URL = 'https://dexto.ai/install';
const DEFAULT_WINDOWS_INSTALL_URL = 'https://dexto.ai/install.ps1';

export type InstallMethod = 'native' | 'npm' | 'unknown';
export type UnsupportedPackageManager = 'pnpm' | 'bun';

type MetadataInstallMethod = Exclude<InstallMethod, 'unknown'>;

const InstallMetadataSchema = z
    .object({
        schemaVersion: z.number().int().positive().default(1),
        method: z.enum(['native', 'npm']),
        installedPath: z.string().min(1),
        installedAt: z.string().min(1),
        version: z.string().min(1),
        sourceUrl: z.string().min(1).optional(),
        releaseTag: z.string().min(1).optional(),
        platform: z.string().min(1).optional(),
        arch: z.string().min(1).optional(),
    })
    .strict();

export type InstallMetadata = z.output<typeof InstallMetadataSchema>;

export interface InstallDetectionResult {
    method: InstallMethod;
    source: 'metadata' | 'heuristic';
    metadata: InstallMetadata | null;
    installedPath: string | null;
    installDir: string | null;
    allDetectedPaths: string[];
    multipleInstallWarning: string | null;
}

interface DetectInstallMethodDeps {
    readMetadata: () => Promise<InstallMetadata | null>;
    getPathEntries: () => Promise<string[]>;
    detectNodeManager: (binaryPath: string) => Promise<InstallMethod | null>;
    pathExists: (targetPath: string) => Promise<boolean>;
}

export interface CommandExecutionResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface ExecuteCommandOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: 'pipe' | 'inherit';
}

export interface ExecutableCommand {
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
    displayCommand: string;
}

export interface NativeInstallOptions {
    version: string | null;
    installDir: string | null;
    force: boolean;
}

export interface PackageManagerCommand {
    command: string;
    args: string[];
    displayCommand: string;
}

export interface SelfUninstallPaths {
    cachePaths: string[];
    configPaths: string[];
    dataPaths: string[];
}

export async function executeCommand(
    command: string,
    args: string[],
    options: ExecuteCommandOptions = {}
): Promise<CommandExecutionResult> {
    const stdio = options.stdio ?? 'pipe';

    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';

        if (stdio === 'pipe') {
            if (child.stdout) {
                child.stdout.on('data', (chunk: Buffer) => {
                    stdout += chunk.toString();
                });
            }

            if (child.stderr) {
                child.stderr.on('data', (chunk: Buffer) => {
                    stderr += chunk.toString();
                });
            }
        }

        child.on('error', (error: Error) => {
            resolve({
                code: -1,
                stdout,
                stderr: `${stderr}\n${error.message}`.trim(),
            });
        });

        child.on('close', (code: number | null) => {
            resolve({
                code: code ?? -1,
                stdout,
                stderr,
            });
        });
    });
}

export async function executeManagedCommand(
    commandSpec: ExecutableCommand,
    options: { dryRun: boolean; cwd?: string }
): Promise<void> {
    if (options.dryRun) {
        console.log(`[dry-run] ${commandSpec.displayCommand}`);
        return;
    }

    const executeOptions: ExecuteCommandOptions = { stdio: 'inherit' };
    if (options.cwd) {
        executeOptions.cwd = options.cwd;
    }
    if (commandSpec.env) {
        executeOptions.env = commandSpec.env;
    }

    const result = await executeCommand(commandSpec.command, commandSpec.args, executeOptions);

    if (result.code !== 0) {
        throw new Error(`Command failed: ${commandSpec.displayCommand}`);
    }
}

export function getInstallMetadataPath(): string {
    return path.join(getDextoHomeDirectory(), 'install.json');
}

function getDextoHomeDirectory(): string {
    return path.join(os.homedir(), '.dexto');
}

export async function readInstallMetadata(): Promise<InstallMetadata | null> {
    const metadataPath = getInstallMetadataPath();

    try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        const validated = InstallMetadataSchema.safeParse(parsed);
        if (!validated.success) {
            return null;
        }
        return validated.data;
    } catch {
        return null;
    }
}

function normalizePathForComparison(targetPath: string): string {
    const normalized = path.normalize(targetPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function uniquePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const candidate of paths) {
        const normalized = normalizePathForComparison(candidate);
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(path.normalize(candidate));
    }

    return result;
}

async function getBinaryPathsFromPath(): Promise<string[]> {
    const result = await executeCommand(DEXTO_PATH_COMMAND, DEXTO_PATH_ARGS);
    if (result.code !== 0) {
        return [];
    }

    const candidates = result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    return uniquePaths(candidates);
}

function inferInstallMethodFromPath(binaryPath: string): InstallMethod {
    const normalized = normalizePathForComparison(binaryPath);

    if (normalized.includes('.dexto') || normalized.includes(path.join('.local', 'bin'))) {
        return 'native';
    }

    if (normalized.includes('node_modules') || normalized.includes(path.join('npm', 'bin'))) {
        return 'npm';
    }

    return 'unknown';
}

function pathStartsWith(targetPath: string, candidatePrefix: string): boolean {
    const normalizedTarget = normalizePathForComparison(targetPath);
    const normalizedPrefix = normalizePathForComparison(candidatePrefix);
    return (
        normalizedTarget === normalizedPrefix ||
        normalizedTarget.startsWith(`${normalizedPrefix}${path.sep}`)
    );
}

function pathBasenameIsDexto(targetPath: string): boolean {
    const basename = path.basename(targetPath).toLowerCase();
    return basename === 'dexto' || basename === 'dexto.exe' || basename === 'dexto.cmd';
}

async function detectNodePackageManagerFromPath(binaryPath: string): Promise<InstallMethod | null> {
    const npmPrefix = await executeCommand('npm', ['prefix', '-g']);
    if (npmPrefix.code === 0) {
        const prefix = npmPrefix.stdout.trim();
        if (prefix.length > 0) {
            const npmBinDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
            if (pathStartsWith(binaryPath, npmBinDir)) {
                return 'npm';
            }
        }
    }

    return null;
}

function normalizePathForSignatureMatch(targetPath: string): string {
    return normalizePathForComparison(targetPath).replace(/\\/g, '/');
}

export function detectUnsupportedPackageManagerFromPath(
    binaryPath: string
): UnsupportedPackageManager | null {
    const normalized = normalizePathForSignatureMatch(binaryPath);

    const pnpmHome = process.env.PNPM_HOME;
    if (pnpmHome && pathStartsWith(binaryPath, pnpmHome)) {
        return 'pnpm';
    }

    const bunInstall = process.env.BUN_INSTALL;
    if (bunInstall && pathStartsWith(binaryPath, path.join(bunInstall, 'bin'))) {
        return 'bun';
    }

    if (
        normalized.includes('/.local/share/pnpm/') ||
        normalized.includes('/appdata/local/pnpm/') ||
        normalized.includes('/pnpm/')
    ) {
        return 'pnpm';
    }

    if (normalized.includes('/.bun/bin/')) {
        return 'bun';
    }

    return null;
}

export function buildMultipleInstallWarning(
    allDetectedPaths: string[],
    activePath: string | null
): string | null {
    if (allDetectedPaths.length <= 1) {
        return null;
    }

    const formattedPaths = allDetectedPaths
        .map((entry, index) => {
            const isActive =
                activePath !== null &&
                normalizePathForComparison(entry) === normalizePathForComparison(activePath);
            const prefix = isActive || (activePath === null && index === 0) ? '*' : '-';
            return `${prefix} ${entry}`;
        })
        .join('\n');

    return [
        'Multiple dexto binaries detected in PATH:',
        formattedPaths,
        'The active binary is marked with *.',
    ].join('\n');
}

function normalizeInstallMethodFromMetadata(method: MetadataInstallMethod): InstallMethod {
    return method;
}

export async function detectInstallMethod(): Promise<InstallDetectionResult> {
    return await detectInstallMethodWithDeps();
}

export async function detectInstallMethodWithDeps(
    deps: Partial<DetectInstallMethodDeps> = {}
): Promise<InstallDetectionResult> {
    const readMetadata = deps.readMetadata ?? readInstallMetadata;
    const getPathEntries = deps.getPathEntries ?? getBinaryPathsFromPath;
    const detectNodeManager = deps.detectNodeManager ?? detectNodePackageManagerFromPath;
    const pathExistsFn = deps.pathExists ?? pathExists;

    const metadata = await readMetadata();
    const allDetectedPaths = await getPathEntries();
    const activePath = allDetectedPaths[0] ?? null;

    async function detectMethodFromActivePath(pathEntry: string): Promise<InstallMethod> {
        let method = inferInstallMethodFromPath(pathEntry);
        if (method === 'unknown' || method === 'native') {
            const pmMethod = await detectNodeManager(pathEntry);
            if (pmMethod) {
                method = pmMethod;
            }
        }

        if (method === 'unknown' && pathBasenameIsDexto(pathEntry)) {
            const normalizedPath = normalizePathForComparison(pathEntry);
            if (
                normalizedPath.includes(
                    normalizePathForComparison(path.join(os.homedir(), '.local', 'bin'))
                )
            ) {
                method = 'native';
            }
        }

        return method;
    }

    if (metadata) {
        const installedPath = metadata.installedPath;
        const metadataPathExists = await pathExistsFn(installedPath);
        const metadataMatchesActivePath =
            activePath !== null &&
            normalizePathForComparison(activePath) === normalizePathForComparison(installedPath);
        const metadataIsTrusted =
            metadataPathExists && (allDetectedPaths.length === 0 || metadataMatchesActivePath);

        if (!metadataIsTrusted && activePath) {
            const method = await detectMethodFromActivePath(activePath);

            return {
                method,
                source: 'heuristic',
                metadata,
                installedPath: activePath,
                installDir: path.dirname(activePath),
                allDetectedPaths,
                multipleInstallWarning: buildMultipleInstallWarning(allDetectedPaths, activePath),
            };
        }

        if (!metadataIsTrusted) {
            return {
                method: 'unknown',
                source: 'heuristic',
                metadata,
                installedPath: null,
                installDir: null,
                allDetectedPaths,
                multipleInstallWarning: null,
            };
        }

        const installDir = path.dirname(installedPath);

        return {
            method: normalizeInstallMethodFromMetadata(metadata.method),
            source: 'metadata',
            metadata,
            installedPath,
            installDir,
            allDetectedPaths,
            multipleInstallWarning: buildMultipleInstallWarning(allDetectedPaths, installedPath),
        };
    }

    if (!activePath) {
        return {
            method: 'unknown',
            source: 'heuristic',
            metadata: null,
            installedPath: null,
            installDir: null,
            allDetectedPaths,
            multipleInstallWarning: null,
        };
    }

    const method = await detectMethodFromActivePath(activePath);

    return {
        method,
        source: 'heuristic',
        metadata: null,
        installedPath: activePath,
        installDir: path.dirname(activePath),
        allDetectedPaths,
        multipleInstallWarning: buildMultipleInstallWarning(allDetectedPaths, activePath),
    };
}

function shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandDisplayWithEnv(command: string, envOverrides: Record<string, string>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(envOverrides)) {
        parts.push(`${key}=${shellEscape(value)}`);
    }

    if (parts.length === 0) {
        return command;
    }

    return `${parts.join(' ')} ${command}`;
}

export function createNativeInstallCommand(options: NativeInstallOptions): ExecutableCommand {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const envOverrides: Record<string, string> = {};

    if (options.version) {
        env.DEXTO_VERSION = options.version;
        envOverrides.DEXTO_VERSION = options.version;
    }

    if (options.installDir) {
        env.DEXTO_INSTALL_DIR = options.installDir;
        envOverrides.DEXTO_INSTALL_DIR = options.installDir;
    }

    if (options.force) {
        env.DEXTO_INSTALL_FORCE = '1';
        envOverrides.DEXTO_INSTALL_FORCE = '1';
    }

    if (process.platform === 'win32') {
        const commandText = `irm ${DEFAULT_WINDOWS_INSTALL_URL} | iex`;

        return {
            command: 'powershell',
            args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commandText],
            env,
            displayCommand: commandDisplayWithEnv(
                `powershell -NoProfile -ExecutionPolicy Bypass -Command ${shellEscape(commandText)}`,
                envOverrides
            ),
        };
    }

    const commandText = `curl -fsSL ${DEFAULT_NATIVE_INSTALL_URL} | bash`;

    return {
        command: 'bash',
        args: ['-lc', commandText],
        env,
        displayCommand: commandDisplayWithEnv(commandText, envOverrides),
    };
}

export function resolveUninstallCommandForMethod(
    method: InstallMethod
): PackageManagerCommand | null {
    switch (method) {
        case 'npm':
            return {
                command: 'npm',
                args: ['uninstall', '-g', 'dexto'],
                displayCommand: 'npm uninstall -g dexto',
            };
        default:
            return null;
    }
}

export function normalizeRequestedVersion(version: string | null | undefined): string | null {
    if (!version) {
        return null;
    }

    const trimmed = version.trim();
    if (trimmed.length === 0) {
        return null;
    }

    return trimmed.startsWith('dexto@') ? trimmed.slice('dexto@'.length) : trimmed;
}

export function getSelfUninstallPaths(): SelfUninstallPaths {
    const configPaths = [
        path.join(getDextoHomeDirectory(), 'preferences.yml'),
        path.join(getDextoHomeDirectory(), 'auth.json'),
        path.join(getDextoHomeDirectory(), '.env'),
        path.join(getDextoHomeDirectory(), 'install.json'),
    ];

    const dataPaths = [
        path.join(getDextoHomeDirectory(), 'agents'),
        path.join(getDextoHomeDirectory(), 'blobs'),
        path.join(getDextoHomeDirectory(), 'database'),
        path.join(getDextoHomeDirectory(), 'images'),
        path.join(getDextoHomeDirectory(), 'models'),
        path.join(getDextoHomeDirectory(), 'plugins'),
        path.join(getDextoHomeDirectory(), 'skills'),
        path.join(getDextoHomeDirectory(), 'logs'),
    ];

    const cachePaths = [path.join(getDextoHomeDirectory(), 'cache')];

    return {
        cachePaths,
        configPaths,
        dataPaths,
    };
}

export async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.lstat(targetPath);
        return true;
    } catch {
        return false;
    }
}

export async function removePath(targetPath: string): Promise<void> {
    const stat = await fs.lstat(targetPath);
    if (stat.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
        return;
    }

    await fs.rm(targetPath, { force: true });
}

export function getDefaultNativeBinaryPath(): string {
    if (process.platform === 'win32') {
        return path.join(os.homedir(), '.dexto', 'bin', DEXTO_BINARY);
    }

    return path.join(os.homedir(), '.local', 'bin', DEXTO_BINARY);
}
