import { describe, expect, it } from 'vitest';
import { buildShellEnvironment } from './shell-environment.js';

describe('buildShellEnvironment', () => {
    it('passes only the allowlisted host variables', () => {
        const result = buildShellEnvironment({
            PATH: '/usr/bin',
            HOME: '/home/user',
            USER: 'user',
            SHELL: '/bin/bash',
            LANG: 'en_US.UTF-8',
            LC_ALL: 'C',
            TERM: 'xterm',
            TMPDIR: '/tmp',
            OPENAI_API_KEY: 'sk-openai',
            ANTHROPIC_API_KEY: 'sk-anthropic',
            DEXTO_SERVER_API_KEY: 'server-key',
            AWS_SECRET_ACCESS_KEY: 'aws-secret',
        });

        expect(result).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/user',
            USER: 'user',
            SHELL: '/bin/bash',
            LANG: 'en_US.UTF-8',
            LC_ALL: 'C',
            TERM: 'xterm',
            TMPDIR: '/tmp',
        });
    });

    it('adds explicitly configured variables, later sources winning', () => {
        const result = buildShellEnvironment(
            { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-openai' },
            { MY_TOKEN: 'configured', PATH: '/configured/bin' },
            { MY_TOKEN: 'per-call' },
            undefined
        );

        expect(result).toEqual({ PATH: '/configured/bin', MY_TOKEN: 'per-call' });
    });

    it('skips unset host variables', () => {
        expect(buildShellEnvironment({ PATH: undefined, HOME: '/home/user' })).toEqual({
            HOME: '/home/user',
        });
    });
});
