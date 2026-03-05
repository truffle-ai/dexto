import { describe, it, expect } from 'vitest';
import path from 'path';
import {
    buildMultipleInstallWarning,
    commandDisplayWithEnvPosix,
    commandDisplayWithEnvPowerShell,
    createNativeInstallCommand,
    detectUnsupportedPackageManagerFromPath,
    detectInstallMethodWithDeps,
    getSelfUninstallPaths,
    normalizeRequestedVersion,
    resolveUninstallCommandForMethod,
    type InstallMetadata,
} from './self-management.js';

describe('self-management utils', () => {
    it('prefers install metadata when metadata path matches active binary', async () => {
        const metadata: InstallMetadata = {
            schemaVersion: 1,
            method: 'native',
            installedPath: '/Users/test/.local/bin/dexto',
            installedAt: '2026-03-03T12:00:00Z',
            version: '1.6.8',
        };

        const result = await detectInstallMethodWithDeps({
            readMetadata: async () => metadata,
            getPathEntries: async () => ['/Users/test/.local/bin/dexto', '/usr/local/bin/dexto'],
            detectNodeManager: async () => 'npm',
            pathExists: async () => true,
        });

        expect(result.method).toBe('native');
        expect(result.source).toBe('metadata');
        expect(result.installedPath).toBe('/Users/test/.local/bin/dexto');
    });

    it('uses active PATH binary when metadata path is present but not active', async () => {
        const metadata: InstallMetadata = {
            schemaVersion: 1,
            method: 'native',
            installedPath: '/Users/test/.local/bin/dexto',
            installedAt: '2026-03-03T12:00:00Z',
            version: '1.6.8',
        };

        const result = await detectInstallMethodWithDeps({
            readMetadata: async () => metadata,
            getPathEntries: async () => ['/usr/local/bin/dexto', '/Users/test/.local/bin/dexto'],
            detectNodeManager: async () => 'npm',
            pathExists: async () => true,
        });

        expect(result.method).toBe('npm');
        expect(result.source).toBe('heuristic');
        expect(result.installedPath).toBe('/usr/local/bin/dexto');
    });

    it('uses fallback node package-manager detection when metadata is missing', async () => {
        const result = await detectInstallMethodWithDeps({
            readMetadata: async () => null,
            getPathEntries: async () => ['/usr/local/bin/dexto'],
            detectNodeManager: async () => 'npm',
        });

        expect(result.method).toBe('npm');
        expect(result.source).toBe('heuristic');
        expect(result.installedPath).toBe('/usr/local/bin/dexto');
    });

    it('falls back to heuristics when metadata path is stale', async () => {
        const metadata: InstallMetadata = {
            schemaVersion: 1,
            method: 'native',
            installedPath: '/Users/test/.local/bin/dexto',
            installedAt: '2026-03-03T12:00:00Z',
            version: '1.6.8',
        };

        const result = await detectInstallMethodWithDeps({
            readMetadata: async () => metadata,
            getPathEntries: async () => ['/usr/local/bin/dexto'],
            detectNodeManager: async () => 'npm',
            pathExists: async () => false,
        });

        expect(result.method).toBe('npm');
        expect(result.source).toBe('heuristic');
        expect(result.installedPath).toBe('/usr/local/bin/dexto');
    });

    it('keeps metadata result when binary is not on PATH but metadata path exists', async () => {
        const metadata: InstallMetadata = {
            schemaVersion: 1,
            method: 'native',
            installedPath: '/Users/test/.local/bin/dexto',
            installedAt: '2026-03-03T12:00:00Z',
            version: '1.6.8',
        };

        const result = await detectInstallMethodWithDeps({
            readMetadata: async () => metadata,
            getPathEntries: async () => [],
            detectNodeManager: async () => null,
            pathExists: async () => true,
        });

        expect(result.method).toBe('native');
        expect(result.source).toBe('metadata');
        expect(result.installedPath).toBe('/Users/test/.local/bin/dexto');
    });

    it('returns unknown when no binary is found in PATH', async () => {
        const result = await detectInstallMethodWithDeps({
            readMetadata: async () => null,
            getPathEntries: async () => [],
            detectNodeManager: async () => null,
        });

        expect(result.method).toBe('unknown');
        expect(result.installedPath).toBeNull();
    });

    it('builds warning when multiple binaries exist in PATH', () => {
        const warning = buildMultipleInstallWarning(
            ['/usr/local/bin/dexto', '/Users/test/.local/bin/dexto'],
            '/usr/local/bin/dexto'
        );

        expect(warning).toContain('Multiple dexto binaries detected');
        expect(warning).toContain('* /usr/local/bin/dexto');
    });

    it('normalizes optional version input', () => {
        expect(normalizeRequestedVersion(undefined)).toBeNull();
        expect(normalizeRequestedVersion('  ')).toBeNull();
        expect(normalizeRequestedVersion('dexto@1.7.0')).toBe('1.7.0');
        expect(normalizeRequestedVersion('1.7.0')).toBe('1.7.0');
    });

    it('resolves package-manager uninstall commands', () => {
        expect(resolveUninstallCommandForMethod('npm')?.displayCommand).toBe(
            'npm uninstall -g dexto'
        );
        expect(resolveUninstallCommandForMethod('unknown')).toBeNull();
    });

    it('builds native install command payload', () => {
        const command = createNativeInstallCommand({
            version: '1.8.0',
            installDir: '/tmp/dexto-bin',
            force: true,
        });

        expect(command.displayCommand).toContain('DEXTO_VERSION');
        expect(command.displayCommand).toContain('DEXTO_INSTALL_DIR');
        expect(command.displayCommand).toContain('DEXTO_INSTALL_FORCE');
    });

    it('formats display commands with explicit shell syntax', () => {
        const envOverrides = {
            DEXTO_VERSION: '1.8.0',
            DEXTO_INSTALL_DIR: "/tmp/it's-here",
        };

        expect(
            commandDisplayWithEnvPosix('curl -fsSL https://dexto.ai/install | bash', envOverrides)
        ).toContain(`DEXTO_INSTALL_DIR='/tmp/it'\\''s-here'`);

        const powershellDisplay = commandDisplayWithEnvPowerShell(
            "powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://dexto.ai/install.ps1 | iex'",
            envOverrides
        );
        expect(powershellDisplay).toContain(`$env:DEXTO_VERSION='1.8.0';`);
        expect(powershellDisplay).toContain(`$env:DEXTO_INSTALL_DIR='/tmp/it''s-here';`);
    });

    it('provides self-uninstall path groups', () => {
        const paths = getSelfUninstallPaths();

        expect(paths.cachePaths.length).toBeGreaterThan(0);
        expect(paths.configPaths.length).toBeGreaterThan(0);
        expect(paths.dataPaths.length).toBeGreaterThan(0);
        expect(paths.dataPaths.some((entry) => path.basename(entry) === 'blobs')).toBe(true);
    });

    it('detects pnpm/bun signatures for unsupported managers', () => {
        expect(detectUnsupportedPackageManagerFromPath('/home/test/.local/share/pnpm/dexto')).toBe(
            'pnpm'
        );
        expect(detectUnsupportedPackageManagerFromPath('/home/test/.bun/bin/dexto')).toBe('bun');
        expect(detectUnsupportedPackageManagerFromPath('/usr/local/bin/dexto')).toBeNull();
    });
});
