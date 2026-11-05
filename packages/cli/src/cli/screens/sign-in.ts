/**
 * The Signal sign-in screens: `dexto login` in the browser (screen 4), `dexto login --device`
 * with its code (screen 2), and signed in (screen 3). Behind DEXTO_PALETTE=signal; the plain
 * notes in `signInPromptText` stay the default until it ships.
 */
import {
    clock,
    cutRows,
    drawnWidth,
    line,
    link,
    richOutput,
    signalOn,
    span,
    spinnerFrame,
    strong,
    type Span,
} from '@dexto/tui/signal-text';
import type { dextoSignIn } from '@dexto/agent-management';
import {
    plainSignInScreen,
    type SignedIn,
    type SignInScreen,
} from '../commands/auth/sign-in-commands.js';

type SignInPrompt = dextoSignIn.SignInPrompt;

/** What signing in adds on top of the local agent. Screen 1 and screen 3 list the same. */
export const CLOUD_ADDS = [
    'models & credits',
    'connectors',
    'Drive',
    'Skills',
    'memory',
    'Sites & Apps',
    'Loops',
    'cloud computers',
    'Projects',
] as const;

/** `◆ models & credits   ◆ connectors …`, wrapped to `columns`. */
export function cloudAddsLines(columns: number, indent: number): string[] {
    const rows: Span[][] = [[]];
    let width = indent;
    for (const item of CLOUD_ADDS) {
        const cells = item.length + 5;
        const row = rows[rows.length - 1] ?? [];
        if (row.length > 0 && width + cells > columns) {
            rows.push([]);
            width = indent;
        }
        rows[rows.length - 1]?.push(span('cloud', '◆ '), span('fg', `${item}   `));
        width += cells;
    }
    return rows.map((row) => line([span('fg', ' '.repeat(indent)), ...row]).trimEnd());
}

/** `SIGN IN` in cut type, the command and a subtitle beside it. */
function titleLines(command: string, subtitle: string): string[] {
    const cut = cutRows('sign in');
    if (cut.length === 1)
        return [
            line([strong('hi', 'SIGN IN'), span('fg', '  '), strong('teal', command)]),
            line([span('dim', subtitle)]),
        ];
    const beside = [line([strong('teal', command)]), line([span('dim', subtitle)])];
    return cut.map((row, index) => `${row}    ${beside[index] ?? ''}`.trimEnd());
}

/** The user code: cut type at a terminal, the code in bold otherwise. */
export function codeLines(code: string, faded: boolean): string[] {
    return cutRows(code, faded ? 'faint' : 'hi');
}

/** Screen 2: open the link, enter the code. The waiting line follows. */
export function devicePromptLines(prompt: Extract<SignInPrompt, { kind: 'device' }>): string[] {
    const open =
        prompt.verificationUriComplete === null
            ? [
                  span('dim', 'Open '),
                  link(prompt.verificationUri, shortUrl(prompt.verificationUri)),
                  span('dim', ' on any device and enter:'),
              ]
            : [
                  span('dim', 'Open '),
                  link(prompt.verificationUriComplete),
                  span('dim', ' and check it shows:'),
              ];
    return [
        ...titleLines('dexto login --device', 'no browser on this machine, so: a code'),
        '',
        line(open),
        ...codeLines(prompt.userCode, false),
        '',
    ];
}

/** Screen 4: the browser opened; the link in case it didn't. The waiting line follows. */
export function browserPromptLines(prompt: Extract<SignInPrompt, { kind: 'browser' }>): string[] {
    return [
        ...titleLines('dexto login', `opened ${new URL(prompt.authorizeUrl).host} in your browser`),
        '',
        line([span('dim', "Browser didn't open? Use this link:")]),
        line([link(prompt.authorizeUrl)]),
        '',
    ];
}

/** The live line under a prompt: a countdown for a code, time spent for the browser. */
export function waitingLine(prompt: SignInPrompt, elapsedMs: number, tick: number): string {
    const words =
        prompt.kind === 'device'
            ? `waiting for you · expires in ${clock(prompt.expiresInSeconds * 1000 - elapsedMs)}`
            : `waiting for you in the browser · ${clock(elapsedMs)}`;
    return line([span('cloud', spinnerFrame(tick)), span('dim', ` ${words}`)]);
}

/** `app.dexto.ai/auth/device` from its URL: the words people type. */
function shortUrl(url: string): string {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
}

/** Screen 3: who you are now, what that adds, and what next. */
export function signedInLines(signedIn: SignedIn, columns: number): string[] {
    const who =
        signedIn.signedInAs === null
            ? 'Signed in'
            : `Signed in as ${signedIn.signedInAs.account.name} · ${signedIn.signedInAs.organization.name}`;
    return [
        line([span('cloud', '◆ '), span('fg', 'approved in the browser')]),
        '',
        line([span('cloud', '◆ '), strong('cloud', who)]),
        line([
            span(
                'dim',
                `  profile ${signedIn.profile} · stored in ~/.dexto · your provider keys stay on this machine`
            ),
        ]),
        signedIn.cloudProject === null
            ? line([
                  span(
                      'amber',
                      '  This organization has no Cloud project for Dexto models to bill.'
                  ),
              ])
            : line([span('dim', `  Dexto models bill Cloud project ${signedIn.cloudProject}.`)]),
        ...(signedIn.notCurrent
            ? [
                  line([
                      span('dim', '  Other commands still use another profile: pass '),
                      span('teal', `--profile ${signedIn.profile}`),
                      span('dim', ', or run '),
                      span('teal', `dexto accounts use ${signedIn.profile}`),
                  ]),
              ]
            : []),
        '',
        line([span('fg', '  Now available:')]),
        ...cloudAddsLines(columns, 2),
        '',
        line([
            span('dim', '  next: '),
            span('teal', 'dexto'),
            span('dim', '  ·  chats sync to your dashboard from now on (/private, --no-sync)'),
        ]),
    ];
}

/** At a terminal on Signal, the Signal screens on stderr; the plain notes anywhere else. */
export function terminalSignInScreen(
    write: (text: string) => void,
    note: (text: string) => void,
    json: boolean
): SignInScreen {
    // These screens go to stderr, so stderr has to be the terminal.
    if (json || !signalOn() || process.stderr.isTTY !== true) return plainSignInScreen(note);
    return signalSignInScreen(write, process.stderr.columns ?? 80);
}

const CLEAR_LINE = '\r\u001B[2K';

/**
 * Prints a prompt to stderr and keeps its waiting line live until the sign-in settles. On
 * success the code fades. Without a terminal the waiting line is left out.
 */
export function signalSignInScreen(
    write: (text: string) => void,
    columns: number,
    now: () => number = Date.now
): SignInScreen {
    let timer: ReturnType<typeof setInterval> | null = null;
    let shown: SignInPrompt | null = null;
    // Ctrl-C while waiting: end the live line so the shell prompt starts on its own row.
    const onInterrupt = () => {
        write(`${CLEAR_LINE}\n`);
        process.exit(130);
    };
    return {
        look: 'signal',
        signedInText: (signedIn) => signedInLines(signedIn, columns).join('\n'),
        show(prompt: SignInPrompt): void {
            shown = prompt;
            const lines =
                prompt.kind === 'device' ? devicePromptLines(prompt) : browserPromptLines(prompt);
            write(`${lines.join('\n')}\n`);
            // A row that wraps breaks the in-place redraw, so a narrow terminal gets no live line.
            const widest = Math.max(...lines.map(drawnWidth));
            if (!richOutput() || widest > columns) return;
            process.once('SIGINT', onInterrupt);
            const started = now();
            let tick = 0;
            const draw = () =>
                write(`${CLEAR_LINE}${waitingLine(prompt, now() - started, tick++)}`);
            draw();
            timer = setInterval(draw, 100);
        },
        settle(signedIn: boolean): void {
            if (timer === null) return;
            clearInterval(timer);
            timer = null;
            process.off('SIGINT', onInterrupt);
            write(CLEAR_LINE);
            // The code is 3 rows, then a blank row, then this line: fade it in place.
            if (
                signedIn &&
                shown?.kind === 'device' &&
                codeLines(shown.userCode, true).length === 3
            )
                write(
                    `\u001B[4A${codeLines(shown.userCode, true)
                        .map((row) => `${CLEAR_LINE}${row}`)
                        .join('\n')}\n\n`
                );
        },
    };
}
