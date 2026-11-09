import { describe, expect, it } from 'vitest';
import { createLogger } from '@dexto/core';
import { CommandValidator } from './command-validator.js';
import type { ProcessConfig } from './types.js';

const logger = createLogger({
    agentId: 'test-agent',
    config: { level: 'error', transports: [{ type: 'silent' }] },
});

function validatorWith(allowedCommands: string[]): CommandValidator {
    const config: ProcessConfig = {
        securityLevel: 'moderate',
        maxTimeout: 1000,
        maxConcurrentProcesses: 1,
        maxOutputBuffer: 1024,
        allowedCommands,
        blockedCommands: [],
        environment: {},
        passEnvironment: [],
    };
    return new CommandValidator(config, logger);
}

describe('configured command allowlist', () => {
    it('accepts a command that is listed exactly', () => {
        expect(validatorWith(['echo hello']).validateCommand('echo hello').isValid).toBe(true);
    });

    it('rejects a command that only starts with a listed command', () => {
        const validator = validatorWith(['echo hello']);
        expect(validator.validateCommand('echo hello; echo other').isValid).toBe(false);
        expect(validator.validateCommand('echo hello world').isValid).toBe(false);
    });

    it('allows any command when the list is empty', () => {
        expect(validatorWith([]).validateCommand('echo other').isValid).toBe(true);
    });
});
