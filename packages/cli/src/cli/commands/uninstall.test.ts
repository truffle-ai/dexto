import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('../utils/self-management.js', () => ({
    detectInstallMethod: vi.fn(),
    executeManagedCommand: vi.fn(),
    getDefaultNativeBinaryPath: vi.fn(),
    getDextoHomePath: vi.fn(),
    pathExists: vi.fn(),
    removePath: vi.fn(),
    resolveUninstallCommandForMethod: vi.fn(),
    scheduleDeferredWindowsRemoval: vi.fn(),
}));

import { handleUninstallCliCommand } from './uninstall.js';
import {
    detectInstallMethod,
    executeManagedCommand,
    getDefaultNativeBinaryPath,
    getDextoHomePath,
    pathExists,
    removePath,
    resolveUninstallCommandForMethod,
    scheduleDeferredWindowsRemoval,
} from '../utils/self-management.js';

describe('uninstall command', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: originalPlatform });

        vi.mocked(pathExists).mockResolvedValue(true);
        vi.mocked(removePath).mockResolvedValue(undefined);
        vi.mocked(executeManagedCommand).mockResolvedValue(undefined);
        vi.mocked(scheduleDeferredWindowsRemoval).mockResolvedValue(undefined);
        vi.mocked(getDefaultNativeBinaryPath).mockReturnValue('/home/test/.local/bin/dexto');
        vi.mocked(getDextoHomePath).mockReturnValue('/home/test/.dexto');
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uninstalls npm installs via package-manager command and keeps ~/.dexto by default', async () => {
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
        expect(removePath).not.toHaveBeenCalled();
        expect(resolveUninstallCommandForMethod).toHaveBeenCalledWith('npm');
    });

    it('removes native binary and keeps ~/.dexto by default', async () => {
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

        expect(removePath).toHaveBeenCalledTimes(1);
        expect(removePath).toHaveBeenCalledWith('/home/test/.local/bin/dexto');
        expect(scheduleDeferredWindowsRemoval).not.toHaveBeenCalled();
    });

    it('removes ~/.dexto wholesale when --purge is passed', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'native',
            source: 'metadata',
            metadata: null,
            installedPath: '/home/test/.local/bin/dexto',
            installDir: '/home/test/.local/bin',
            allDetectedPaths: ['/home/test/.local/bin/dexto'],
            multipleInstallWarning: null,
        });

        await expect(handleUninstallCliCommand({ purge: true })).resolves.not.toThrow();

        expect(removePath).toHaveBeenCalledWith('/home/test/.local/bin/dexto');
        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto');
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

        await expect(
            handleUninstallCliCommand({ dryRun: true, purge: true })
        ).resolves.not.toThrow();

        expect(removePath).not.toHaveBeenCalled();
        expect(scheduleDeferredWindowsRemoval).not.toHaveBeenCalled();
    });

    it('still removes ~/.dexto on purge when npm uninstall fails', async () => {
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

        await expect(handleUninstallCliCommand({ purge: true })).rejects.toThrow(
            'pm uninstall failed'
        );
        expect(removePath).toHaveBeenCalledWith('/home/test/.dexto');
    });

    it('rejects project-local installs', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'project-local',
            source: 'heuristic',
            metadata: null,
            installedPath: '/repo/node_modules/.bin/dexto',
            installDir: '/repo/node_modules/.bin',
            allDetectedPaths: ['/repo/node_modules/.bin/dexto'],
            multipleInstallWarning: null,
        });

        await expect(handleUninstallCliCommand({})).rejects.toThrow(/project-local install/i);

        expect(executeManagedCommand).not.toHaveBeenCalled();
        expect(removePath).not.toHaveBeenCalled();
    });

    it('defers Windows native binary removal until after exit', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });

        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'native',
            source: 'metadata',
            metadata: null,
            installedPath: process.execPath,
            installDir: '/home/test/.dexto/bin',
            allDetectedPaths: [process.execPath],
            multipleInstallWarning: null,
        });

        await expect(handleUninstallCliCommand({ purge: true })).resolves.not.toThrow();

        expect(scheduleDeferredWindowsRemoval).toHaveBeenCalledWith([
            process.execPath,
            '/home/test/.dexto',
        ]);
        expect(removePath).not.toHaveBeenCalled();
    });
});
