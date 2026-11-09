import type { Logger } from '@dexto/core/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessService } from './process-service.js';
import { ProcessToolsConfigSchema } from './tool-factory-config.js';
import type { ProcessResult } from './types.js';

function createLogger(): Logger {
    const logger: Partial<Logger> = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        createChild: () => createLogger(),
    };
    return logger as Logger;
}

function createService(environment: Record<string, string> = {}): ProcessService {
    const config = ProcessToolsConfigSchema.parse({
        type: 'process-tools',
        securityLevel: 'permissive',
        environment,
    });
    return new ProcessService(config, createLogger());
}

async function readVariable(service: ProcessService, name: string): Promise<string> {
    const result = (await service.executeCommand(`echo "\${${name}:-unset}"`)) as ProcessResult;
    return result.stdout.trim();
}

describe('ProcessService environment', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does not pass provider keys or the server key to commands', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'sk-test-openai');
        vi.stubEnv('DEXTO_SERVER_API_KEY', 'test-server-key');
        const service = createService();

        expect(await readVariable(service, 'OPENAI_API_KEY')).toBe('unset');
        expect(await readVariable(service, 'DEXTO_SERVER_API_KEY')).toBe('unset');
    });

    it('still passes PATH so commands resolve', async () => {
        const service = createService();

        expect(await readVariable(service, 'PATH')).not.toBe('unset');
    });

    it('passes variables the user configured explicitly', async () => {
        vi.stubEnv('MY_CONFIGURED_VALUE', 'from-host');
        const service = createService({ MY_CONFIGURED_VALUE: 'from-config' });

        expect(await readVariable(service, 'MY_CONFIGURED_VALUE')).toBe('from-config');
    });

    it('forwards only the host variables named in passEnvironment', async () => {
        vi.stubEnv('DEXTO_TEST_FORWARDED', 'forwarded-host-value');
        vi.stubEnv('DEXTO_TEST_NOT_FORWARDED', 'other-host-value');
        const config = ProcessToolsConfigSchema.parse({
            type: 'process-tools',
            securityLevel: 'permissive',
            passEnvironment: ['DEXTO_TEST_FORWARDED'],
        });
        const service = new ProcessService(config, createLogger());

        expect(await readVariable(service, 'DEXTO_TEST_FORWARDED')).toBe('forwarded-host-value');
        expect(await readVariable(service, 'DEXTO_TEST_NOT_FORWARDED')).toBe('unset');
    });

    it('applies the same environment to background commands', async () => {
        vi.stubEnv('OPENAI_API_KEY', 'sk-test-openai');
        const service = createService();

        const handle = await service.executeCommand('echo "${OPENAI_API_KEY:-unset}"', {
            runInBackground: true,
        });
        if (!('processId' in handle)) {
            throw new Error('Expected a background process handle.');
        }
        let stdout = '';
        await vi.waitFor(async () => {
            const output = await service.getProcessOutput(handle.processId);
            stdout += output.stdout;
            expect(output.status).not.toBe('running');
        });
        expect(stdout.trim()).toBe('unset');
    });
});
