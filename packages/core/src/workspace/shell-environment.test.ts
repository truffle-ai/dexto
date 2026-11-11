import { describe, expect, it } from 'vitest';
import { buildShellEnvironment, pickHostVariables } from './shell-environment.js';

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
            COLORTERM: 'truecolor',
            TMPDIR: '/tmp',
            TZ: 'UTC',
            XDG_CONFIG_HOME: '/home/user/.config',
            SSL_CERT_FILE: '/etc/ssl/cert.pem',
            SSL_CERT_DIR: '/etc/ssl/certs',
            CURL_CA_BUNDLE: '/etc/ssl/bundle.pem',
            REQUESTS_CA_BUNDLE: '/etc/ssl/bundle.pem',
            ALL_PROXY: 'socks5://proxy:1080',
            all_proxy: 'socks5://proxy:1080',
            NODE_EXTRA_CA_CERTS: '/etc/ssl/extra.pem',
            HTTPS_PROXY: 'http://proxy:3128',
            https_proxy: 'http://proxy:3128',
            NO_PROXY: 'localhost',
            OPENAI_API_KEY: 'sk-openai',
            ANTHROPIC_API_KEY: 'sk-anthropic',
            DEXTO_SERVER_API_KEY: 'server-key',
            AWS_SECRET_ACCESS_KEY: 'aws-secret',
            GH_TOKEN: 'gh-token',
            GITHUB_TOKEN: 'github-token',
            SSH_AUTH_SOCK: '/tmp/agent.sock',
            GIT_ASKPASS: '/bin/askpass',
        });

        expect(Object.keys(result).sort()).toEqual(
            [
                'PATH',
                'HOME',
                'USER',
                'SHELL',
                'LANG',
                'LC_ALL',
                'TERM',
                'COLORTERM',
                'TMPDIR',
                'TZ',
                'XDG_CONFIG_HOME',
                'SSL_CERT_FILE',
                'SSL_CERT_DIR',
                'CURL_CA_BUNDLE',
                'REQUESTS_CA_BUNDLE',
                'ALL_PROXY',
                'all_proxy',
                'NODE_EXTRA_CA_CERTS',
                'HTTPS_PROXY',
                'https_proxy',
                'NO_PROXY',
            ].sort()
        );
    });

    it('passes the Windows variables processes need', () => {
        const windows = {
            SystemRoot: 'C:\\Windows',
            USERNAME: 'user',
            APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
            LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local',
            'ProgramFiles(x86)': 'C:\\Program Files (x86)',
            PROCESSOR_ARCHITECTURE: 'AMD64',
            HOMEDRIVE: 'C:',
            HOMEPATH: '\\Users\\user',
        };

        expect(buildShellEnvironment(windows)).toEqual(windows);
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

describe('pickHostVariables', () => {
    it('returns only the named variables that are set', () => {
        expect(
            pickHostVariables({ GH_TOKEN: 'a', GITHUB_TOKEN: undefined, OTHER: 'b' }, [
                'GH_TOKEN',
                'GITHUB_TOKEN',
                'MISSING',
            ])
        ).toEqual({ GH_TOKEN: 'a' });
    });
});
