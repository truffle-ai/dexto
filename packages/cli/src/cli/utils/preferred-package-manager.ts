import { spawnSync } from 'child_process';

export type PreferredPackageManager = 'bun' | 'npm';

let cachedPreferred: PreferredPackageManager | null = null;

function canRun(command: string): boolean {
    const result = spawnSync(command, ['--version'], {
        stdio: 'ignore',
        // Needed for Windows where `npm` is typically `npm.cmd`.
        shell: process.platform === 'win32',
    });

    if (result.error) {
        return false;
    }

    return result.status === 0;
}

export function getPreferredGlobalPackageManager(): PreferredPackageManager {
    const override = process.env.DEXTO_PREFERRED_PACKAGE_MANAGER;
    if (override === 'bun' || override === 'npm') {
        return override;
    }

    if (cachedPreferred) {
        return cachedPreferred;
    }

    cachedPreferred = canRun('bun') ? 'bun' : 'npm';
    return cachedPreferred;
}

export function getGlobalUpdateCommand(): string {
    const pm = getPreferredGlobalPackageManager();
    return pm === 'bun' ? 'bun add -g dexto@latest' : 'npm i -g dexto@latest';
}
