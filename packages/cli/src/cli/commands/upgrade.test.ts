import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/self-management.js', () => ({
    createNativeInstallCommand: vi.fn(),
    detectInstallMethod: vi.fn(),
    detectUnsupportedPackageManagerFromPath: vi.fn(),
    executeManagedCommand: vi.fn(),
    normalizeRequestedVersion: vi.fn(),
    resolveUninstallCommandForMethod: vi.fn(),
}));

import { handleUpgradeCommand } from './upgrade.js';
import {
    createNativeInstallCommand,
    detectInstallMethod,
    detectUnsupportedPackageManagerFromPath,
    executeManagedCommand,
    normalizeRequestedVersion,
    resolveUninstallCommandForMethod,
} from '../utils/self-management.js';

describe('upgrade command', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(normalizeRequestedVersion).mockReturnValue(null);
        vi.mocked(createNativeInstallCommand).mockReturnValue({
            command: 'bash',
            args: ['-lc', 'install'],
            displayCommand: 'install',
        });
        vi.mocked(detectUnsupportedPackageManagerFromPath).mockReturnValue(null);
        vi.mocked(executeManagedCommand).mockResolvedValue(undefined);
    });

    it('uses native installer for native installs', async () => {
        vi.mocked(detectInstallMethod)
            .mockResolvedValueOnce({
                method: 'native',
                source: 'metadata',
                metadata: null,
                installedPath: '/Users/test/.local/bin/dexto',
                installDir: '/Users/test/.local/bin',
                allDetectedPaths: ['/Users/test/.local/bin/dexto'],
                multipleInstallWarning: null,
            })
            .mockResolvedValueOnce({
                method: 'native',
                source: 'metadata',
                metadata: null,
                installedPath: '/Users/test/.local/bin/dexto',
                installDir: '/Users/test/.local/bin',
                allDetectedPaths: ['/Users/test/.local/bin/dexto'],
                multipleInstallWarning: null,
            });

        await expect(handleUpgradeCommand(undefined, {})).resolves.not.toThrow();

        expect(createNativeInstallCommand).toHaveBeenCalledWith({
            version: null,
            installDir: '/Users/test/.local/bin',
            force: false,
        });
        expect(executeManagedCommand).toHaveBeenCalledTimes(1);
    });

    it('auto-migrates npm installs to native and uninstalls npm package', async () => {
        vi.mocked(detectInstallMethod)
            .mockResolvedValueOnce({
                method: 'npm',
                source: 'heuristic',
                metadata: null,
                installedPath: '/usr/local/bin/dexto',
                installDir: '/usr/local/bin',
                allDetectedPaths: ['/usr/local/bin/dexto'],
                multipleInstallWarning: null,
            })
            .mockResolvedValueOnce({
                method: 'native',
                source: 'metadata',
                metadata: null,
                installedPath: '/Users/test/.local/bin/dexto',
                installDir: '/Users/test/.local/bin',
                allDetectedPaths: ['/Users/test/.local/bin/dexto'],
                multipleInstallWarning: null,
            });

        vi.mocked(resolveUninstallCommandForMethod).mockReturnValue({
            command: 'npm',
            args: ['uninstall', '-g', 'dexto'],
            displayCommand: 'npm uninstall -g dexto',
        });

        await expect(handleUpgradeCommand(undefined, {})).resolves.not.toThrow();

        expect(createNativeInstallCommand).toHaveBeenCalledWith({
            version: null,
            installDir: null,
            force: false,
        });
        expect(executeManagedCommand).toHaveBeenCalledTimes(2);
        expect(resolveUninstallCommandForMethod).toHaveBeenCalledWith('npm');
    });

    it('falls back to native installer when method is unknown', async () => {
        vi.mocked(detectInstallMethod)
            .mockResolvedValueOnce({
                method: 'unknown',
                source: 'heuristic',
                metadata: null,
                installedPath: null,
                installDir: null,
                allDetectedPaths: [],
                multipleInstallWarning: null,
            })
            .mockResolvedValueOnce({
                method: 'native',
                source: 'metadata',
                metadata: null,
                installedPath: '/Users/test/.local/bin/dexto',
                installDir: '/Users/test/.local/bin',
                allDetectedPaths: ['/Users/test/.local/bin/dexto'],
                multipleInstallWarning: null,
            });

        await expect(handleUpgradeCommand(undefined, {})).resolves.not.toThrow();

        expect(createNativeInstallCommand).toHaveBeenCalledWith({
            version: null,
            installDir: null,
            force: false,
        });
    });

    it('rejects project-local installs before attempting self-upgrade', async () => {
        vi.mocked(detectInstallMethod).mockResolvedValue({
            method: 'project-local',
            source: 'heuristic',
            metadata: null,
            installedPath: '/repo/node_modules/.bin/dexto',
            installDir: '/repo/node_modules/.bin',
            allDetectedPaths: ['/repo/node_modules/.bin/dexto'],
            multipleInstallWarning: null,
        });

        await expect(handleUpgradeCommand(undefined, {})).rejects.toThrow(/project-local install/i);

        expect(createNativeInstallCommand).not.toHaveBeenCalled();
        expect(executeManagedCommand).not.toHaveBeenCalled();
    });

    it('throws when non-native binary remains active after migration fallback', async () => {
        vi.mocked(detectInstallMethod)
            .mockResolvedValueOnce({
                method: 'unknown',
                source: 'heuristic',
                metadata: null,
                installedPath: '/home/test/.local/share/pnpm/dexto',
                installDir: '/home/test/.local/share/pnpm',
                allDetectedPaths: ['/home/test/.local/share/pnpm/dexto'],
                multipleInstallWarning: null,
            })
            .mockResolvedValueOnce({
                method: 'unknown',
                source: 'heuristic',
                metadata: null,
                installedPath: '/home/test/.local/share/pnpm/dexto',
                installDir: '/home/test/.local/share/pnpm',
                allDetectedPaths: ['/home/test/.local/share/pnpm/dexto'],
                multipleInstallWarning: null,
            });

        vi.mocked(detectUnsupportedPackageManagerFromPath).mockReturnValue('pnpm');

        await expect(handleUpgradeCommand(undefined, {})).rejects.toThrow(
            /active binary is still non-native/i
        );
    });
});
