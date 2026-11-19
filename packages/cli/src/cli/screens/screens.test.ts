import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { TERMINAL_NAMES, drawText } from '@dexto/tui/signal-harness';
import { drawnWidth } from '@dexto/tui/signal-text';
import type { dextoAccounts } from '@dexto/agent-management';
import { failureLines } from './fault.js';
import { firstRunLines, type FirstRunFacts } from './first-run.js';
import { pageHelpLines, rootHelpLines, wrapWords } from './help.js';
import { browserPromptLines, devicePromptLines, signedInLines, waitingLine } from './sign-in.js';
import { signedOutLines, whoamiLines } from './whoami.js';
import { updateNoticeLines } from '../utils/version-check.js';

const FACTS: FirstRunFacts = {
    version: '2.0.0',
    columns: 124,
    rows: 30,
    cwd: '~/code/acme-api',
    git: { branch: 'main', uncommitted: 3 },
    model: { envKey: 'ANTHROPIC_API_KEY', model: 'anthropic/claude-sonnet-4-5' },
    signedInAs: null,
};

const DEVICE = {
    kind: 'device',
    userCode: 'KX7R-49QD',
    verificationUri: 'https://app.dexto.ai/auth/device',
    verificationUriComplete: null,
    expiresInSeconds: 600,
    organization: 'acme',
    scopes: ['cloud:read', 'sessions:write', 'projects:write'],
    computer: 'sams-laptop',
} as const;

const BROWSER = {
    kind: 'browser',
    authorizeUrl:
        'https://app.dexto.ai/oauth/authorize?client_id=dexto-cli&response_type=code&state=s',
} as const;

const SAM = {
    account: { email: 'sam@acme.co', id: 'acc_1', name: 'Sam Rivera' },
    organization: { id: 'org_1', name: 'Acme', slug: 'acme' },
};

const LOGIN: dextoAccounts.OAuthLogin = {
    kind: 'oauth',
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: '2099-01-01T00:00:00.000Z',
    clientId: 'dexto-cli',
    appUrl: 'https://app.dexto.ai',
    apiBaseUrl: 'https://api.dexto.ai',
    resource: 'https://app.dexto.ai/mcp',
    tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
    scopes: ['cloud:read', 'drive:read', 'memory:read'],
    savedAt: '2026-11-01T00:00:00.000Z',
    cloudProject: { id: 'prj_1', name: 'Default' },
    signedInAs: SAM,
};

function program(): Command {
    const root = new Command('dexto').option('--model <id>', 'Specify the LLM model to use');
    for (const [name, description] of [
        ['run', 'Run one prompt and print the result'],
        ['chat', "Your chats: this machine's sessions"],
        ['publish', 'Publish a file, folder or .zip as a link anyone with it can open'],
        ['login', 'Sign in to Dexto with your browser or a device code'],
        ['whoami', 'Show who Dexto commands act as'],
        ['logout', 'End the sign-in on the server and forget it here'],
        ['upgrade', 'Upgrade dexto, or install a given version'],
    ] as const)
        root.command(name).description(description);
    return root;
}

/** Screens whose layout depends on the terminal width. */
const BY_WIDTH: Readonly<Record<string, (columns: number) => string[]>> = {
    '1 first run': (columns) => firstRunLines({ ...FACTS, columns }),
    '3 signed in': (columns) =>
        signedInLines(
            { signedInAs: SAM, profile: 'default', cloudProject: 'Default', notCurrent: false },
            columns
        ),
    '3 signed in, other profile': (columns) =>
        signedInLines(
            { signedInAs: SAM, profile: 'work', cloudProject: 'Default', notCurrent: true },
            columns
        ),
    '3 signed in, longer profile': (columns) =>
        signedInLines(
            { signedInAs: SAM, profile: 'acme-work', cloudProject: 'Default', notCurrent: false },
            columns
        ),
    '7 help': (columns) => rootHelpLines(program(), program().createHelp(), '2.0.0', columns),
};

const SCREENS: Readonly<Record<string, () => string[]>> = {
    '2 device code, waiting': () => [...devicePromptLines(DEVICE), waitingLine(DEVICE, 19_000, 3)],
    '4 browser, waiting': () => [...browserPromptLines(BROWSER), waitingLine(BROWSER, 6_000, 3)],
    '3 signed in, no project': () =>
        signedInLines(
            { signedInAs: SAM, profile: 'work', cloudProject: null, notCurrent: true },
            80
        ),
    '5 whoami': () => whoamiLines('default', LOGIN),
    '5 whoami, no project': () => whoamiLines('default', { ...LOGIN, cloudProject: null }),
    '5 whoami, signed out': () => signedOutLines(),
    '6 fault': () =>
        failureLines(
            {
                code: 'needs_permission',
                message: 'This sign-in cannot write to Drive.',
                apiCode: 'insufficient_scope',
                details: { scope: 'drive:write' },
                fix: 'dexto login --scope drive:write',
            },
            'dexto drive put --help'
        ),
    '6 usage mistake': () =>
        failureLines(
            {
                code: 'usage',
                message: 'Unknown command: dexto cloud projcts',
                apiCode: null,
                details: null,
                fix: null,
            },
            'dexto --help'
        ),
    '7 help, one command': () =>
        pageHelpLines(
            'dexto login [options]',
            'Sign in to Dexto with your browser.',
            [
                {
                    title: 'options',
                    rows: [
                        { term: '--device', description: 'Approve a code on any device.' },
                        { term: '--org ORG', description: 'Sign in for this organization.' },
                    ],
                },
            ],
            80
        ),
    '8 update': () =>
        updateNoticeLines({ current: '2.1.0', latest: '2.2.0', updateCommand: 'dexto upgrade' }),
};

describe('Signal screens', () => {
    it('print plain words, with no escapes, when colour is off', () => {
        for (const draw of Object.values(SCREENS))
            expect(drawText('no-color', draw)).not.toContain('␛');
    });

    it('keep the first run to the two ways on: sign in, or a provider key', () => {
        const out = drawText('no-color', () => firstRunLines(FACTS));
        expect(out).toContain('1 sign in      dexto login');
        expect(out).toContain('2 or a key     export ANTHROPIC_API_KEY=…');
        expect(out).toMatch(/▪ terminal\s+none · 124×30 · unicode · dark background\s+OK/u);
        expect(out).toMatch(/▫ cloud\s+signed out · local works fully without it\s+SKIP/u);
    });

    it("list the root's own options in help, after the ones commands read", () => {
        const out = drawText('no-color', () => BY_WIDTH['7 help']?.(124) ?? []);
        expect(out).toMatch(/--json\s+Print JSON/u);
        expect(out).toMatch(/--model <id>\s+Specify the LLM model to use/u);
    });

    it.each([
        ['7 help', 40],
        ['7 help', 60],
        ['7 help', 80],
        ['3 signed in', 80],
        ['3 signed in, longer profile', 80],
        ['3 signed in, other profile', 80],
    ])('keep every row of %s inside %i columns', (name, columns) => {
        const rows = drawText('no-color', () => BY_WIDTH[name]?.(columns) ?? []).split('\n');
        expect(rows.filter((row) => drawnWidth(row) > columns)).toEqual([]);
    });

    it('wrap a long help description under its column, words unchanged', () => {
        const out = drawText('no-color', () => BY_WIDTH['7 help']?.(80) ?? []).split('\n');
        const at = out.findIndex((row) => row.startsWith('  publish'));
        expect(out.slice(at, at + 2)).toEqual([
            '  publish        Publish a file, folder or .zip as a link anyone with it can',
            '                 open',
        ]);
        expect(wrapWords('a verylongword b', 5)).toEqual(['a', 'veryl', 'ongwo', 'rd b']);
        expect(wrapWords('', 10)).toEqual(['']);
    });

    it('split the signed-in profile row and the other-profile hint only when they do not fit', () => {
        const signedIn = {
            signedInAs: SAM,
            profile: 'default',
            cloudProject: 'Default',
            notCurrent: false,
        };
        expect(drawText('no-color', () => signedInLines(signedIn, 124))).toContain(
            '  profile default · stored in ~/.dexto · your provider keys stay on this machine\n'
        );
        expect(drawText('no-color', () => signedInLines(signedIn, 80))).toContain(
            '  profile default · stored in ~/.dexto · your provider keys stay on this machine\n'
        );
        const longer = { ...signedIn, profile: 'acme-work' };
        expect(drawText('no-color', () => signedInLines(longer, 80))).toContain(
            '  profile acme-work · stored in ~/.dexto\n  your provider keys stay on this machine\n'
        );
        expect(drawText('no-color', () => signedInLines(longer, 124))).toContain(
            '  profile acme-work · stored in ~/.dexto · your provider keys stay on this machine\n'
        );
        const other = { ...signedIn, profile: 'work', notCurrent: true };
        expect(drawText('no-color', () => signedInLines(other, 124))).toContain(
            '  Other commands still use another profile: pass --profile work, or run dexto accounts use work'
        );
        expect(drawText('no-color', () => signedInLines(other, 80))).toContain(
            '  Other commands still use another profile: pass --profile work,\n  or run dexto accounts use work'
        );
    });

    it('point a usage mistake at help instead of printing it', () => {
        expect(drawText('no-color', SCREENS['6 usage mistake'] ?? (() => []))).toBe(
            [
                '  ▌ FAULT   Unknown command: dexto cloud projcts',
                '',
                '  every command: dexto --help',
            ].join('\n')
        );
    });

    it('show the code when the server gives a link that already has it', () => {
        const out = drawText('no-color', () =>
            devicePromptLines({
                ...DEVICE,
                verificationUriComplete: 'https://app.dexto.ai/auth/device?code=KX7R-49QD',
            })
        );
        expect(out).toContain(
            'Open https://app.dexto.ai/auth/device?code=KX7R-49QD and check it shows the code below:'
        );
    });
});

describe.each(TERMINAL_NAMES)('Signal screens on %s', (terminal) => {
    it.each(Object.keys(SCREENS))('%s', (name) => {
        expect(drawText(terminal, SCREENS[name] ?? (() => []))).toMatchSnapshot();
    });

    describe.each([80, 124])('at %i columns', (columns) => {
        it.each(Object.keys(BY_WIDTH))('%s', (name) => {
            expect(drawText(terminal, () => BY_WIDTH[name]?.(columns) ?? [])).toMatchSnapshot();
        });
    });
});
