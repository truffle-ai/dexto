import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/self-management.js', () => ({
    createNativeInstallCommand: vi.fn(),
    detectInstallMethod: vi.fn(),
    executeManagedCommand: vi.fn(),
    normalizeRequestedVersion: vi.fn(),
    resolveUninstallCommandForMethod: vi.fn(),
}));

import { handleUpgradeCommand } from './upgrade.js';
import {
    createNativeInstallCommand,
    detectInstallMethod,
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
});
