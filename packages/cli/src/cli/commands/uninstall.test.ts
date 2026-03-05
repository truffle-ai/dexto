import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/self-management.js', () => ({
    detectInstallMethod: vi.fn(),
    executeManagedCommand: vi.fn(),
    getDefaultNativeBinaryPath: vi.fn(),
    getSelfUninstallPaths: vi.fn(),
    pathExists: vi.fn(),
    removePath: vi.fn(),
    resolveUninstallCommandForMethod: vi.fn(),
}));

import { handleUninstallCliCommand } from './uninstall.js';
import {
    detectInstallMethod,
    executeManagedCommand,
    getDefaultNativeBinaryPath,
    getSelfUninstallPaths,
    pathExists,
    removePath,
    resolveUninstallCommandForMethod,
} from '../utils/self-management.js';

describe('uninstall command', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(getSelfUninstallPaths).mockReturnValue({
            cachePaths: ['/home/test/.dexto/cache'],
            configPaths: ['/home/test/.dexto/preferences.yml'],
            dataPaths: ['/home/test/.dexto/agents'],
        });

        vi.mocked(pathExists).mockResolvedValue(true);
        vi.mocked(removePath).mockResolvedValue(undefined);
        vi.mocked(executeManagedCommand).mockResolvedValue(undefined);
        vi.mocked(getDefaultNativeBinaryPath).mockReturnValue('/home/test/.local/bin/dexto');
    });

    it('uninstalls npm installs via package-manager command and clears cache by default', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'npm',
            source: 'heuristic',
            metadata: null,
            installedPath: '/usr/local/bin/dexto',
            installDir: '/usr/local/bin',
            allDetectedPaths: ['/usr/local/bin/dexto'],
            multipleInstallWarning: null,
        });

        vi.mocked(resolveUninstallCommandForMethod).mockReturnValue({
            command: 'npm',
            args: ['uninstall', '-g', 'dexto'],
            displayCommand: 'npm uninstall -g dexto',
        });

        await expect(handleUninstallCliCommand({})).resolves.not.toThrow();

        expect(executeManagedCommand).toHaveBeenCalledWith(
            {
                command: 'npm',
                args: ['uninstall', '-g', 'dexto'],
                displayCommand: 'npm uninstall -g dexto',
            },
            { dryRun: false }
        );
        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto/cache');
        expect(resolveUninstallCommandForMethod).toHaveBeenCalledWith('npm');
    });

    it('removes native binary and cache by default', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'native',
            source: 'metadata',
            metadata: null,
            installedPath: '/home/test/.local/bin/dexto',
            installDir: '/home/test/.local/bin',
            allDetectedPaths: ['/home/test/.local/bin/dexto'],
            multipleInstallWarning: null,
        });

        await expect(handleUninstallCliCommand({})).resolves.not.toThrow();

        expect(removePath).toHaveBeenCalledWith('/home/test/.local/bin/dexto');
        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto/cache');
    });

    it('requires --force when removing config or data', async () => {
        await expect(handleUninstallCliCommand({ removeConfig: true })).rejects.toThrow(
            /requires --force/
        );
    });

    it('removes config/data when requested with --force', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'native',
            source: 'metadata',
            metadata: null,
            installedPath: '/home/test/.local/bin/dexto',
            installDir: '/home/test/.local/bin',
            allDetectedPaths: ['/home/test/.local/bin/dexto'],
            multipleInstallWarning: null,
        });

        await expect(
            handleUninstallCliCommand({ removeConfig: true, removeData: true, force: true })
        ).resolves.not.toThrow();

        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto/preferences.yml');
        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto/agents');
    });

    it('supports dry-run mode without deleting files', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'native',
            source: 'metadata',
            metadata: null,
            installedPath: '/home/test/.local/bin/dexto',
            installDir: '/home/test/.local/bin',
            allDetectedPaths: ['/home/test/.local/bin/dexto'],
            multipleInstallWarning: null,
        });

        await expect(handleUninstallCliCommand({ dryRun: true })).resolves.not.toThrow();

        expect(removePath).not.toHaveBeenCalled();
    });

    it('continues local cleanup when package-manager uninstall fails and then throws', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'npm',
            source: 'heuristic',
            metadata: null,
            installedPath: '/usr/local/bin/dexto',
            installDir: '/usr/local/bin',
            allDetectedPaths: ['/usr/local/bin/dexto'],
            multipleInstallWarning: null,
        });

        vi.mocked(resolveUninstallCommandForMethod).mockReturnValue({
            command: 'npm',
            args: ['uninstall', '-g', 'dexto'],
            displayCommand: 'npm uninstall -g dexto',
        });

        vi.mocked(executeManagedCommand).mockRejectedValue(new Error('pm uninstall failed'));

        await expect(handleUninstallCliCommand({})).rejects.toThrow('pm uninstall failed');
        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto/cache');
    });
});
