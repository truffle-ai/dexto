/**
 * The Signal sign-in screens: `dexto login` in the browser (screen 4), `dexto login --device`
 * with its code (screen 2), and signed in (screen 3). Behind DEXTO_PALETTE=signal; the plain
 * notes in `signInPromptText` stay the default until it ships.
 */
import {
    capsFor,
    clock,
    cutRows,
    drawOn,
    drawnWidth,
    line,
    link,
    richOutput,
    signalOn,
    span,
    spansWidth,
    spinnerFrame,
    strong,
    type Caps,
    type Span,
} from '@dexto/tui/signal-text';
import { dextoSignIn } from '@dexto/agent-management';
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

const ROW_LABEL_WIDTH = 14;

/** The Code row, bright while waiting and faint once signed in. */
export function codeRow(code: string, faded: boolean): string {
    return line([
        span('dim', `  ${'Code'.padEnd(ROW_LABEL_WIDTH)}`),
        strong(faded ? 'faint' : 'hi', code),
    ]);
}

/**
 * The request as the approval page lays it out: Account, Organization, Code, From and Access,
 * one labelled row each, so the terminal and the page read the same.
 */
export function requestRowLines(rows: readonly dextoSignIn.SignInRequestRow[]): string[] {
    return rows.map((row) =>
        row.label === 'Code'
            ? codeRow(row.value, false)
            : line([span('dim', `  ${row.label.padEnd(ROW_LABEL_WIDTH)}`), span('fg', row.value)])
    );
}

/** Screen 2: open the link, check the rows. The waiting line follows. */
export function devicePromptLines(prompt: Extract<SignInPrompt, { kind: 'device' }>): string[] {
    const open =
        prompt.verificationUriComplete === null
            ? [
                  span('dim', 'Open '),
                  link(prompt.verificationUri, shortUrl(prompt.verificationUri)),
                  span('dim', ' on any device and enter the code below:'),
              ]
            : [
                  span('dim', 'Open '),
                  link(prompt.verificationUriComplete),
                  span('dim', ' and check it shows the code below:'),
              ];
    return [
        ...titleLines('dexto login --device', 'no browser on this machine, so: a code'),
        '',
        line(open),
        '',
        ...requestRowLines(dextoSignIn.devicePromptRows(prompt)),
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

/** Spans with the same look, run together: one escape pair instead of several. */
function merged(spans: readonly Span[]): Span[] {
    return spans.reduce<Span[]>((out, each) => {
        const last = out[out.length - 1];
        if (
            last !== undefined &&
            last.role === each.role &&
            last.bold === each.bold &&
            last.href === each.href
        )
            out[out.length - 1] = { ...last, text: last.text + each.text };
        else out.push(each);
        return out;
    }, []);
}

/**
 * `parts` on one indented row, `joint` between them, when it fits in `columns`; otherwise each
 * part on its own indented row.
 */
function rowOrRows(parts: readonly (readonly Span[])[], joint: Span, columns: number): string[] {
    const indent = span('dim', '  ');
    const joined = merged([
        indent,
        ...parts.flatMap((part, index) => (index === 0 ? part : [joint, ...part])),
    ]);
    if (spansWidth(joined) <= columns) return [line(joined)];
    return parts.map((part) => line(merged([indent, ...part])));
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
        // One row when it fits; a profile name longer than `default` overflows 80 columns.
        ...rowOrRows(
            [
                [span('dim', `profile ${signedIn.profile} · stored in ~/.dexto`)],
                [span('dim', 'your provider keys stay on this machine')],
            ],
            span('dim', ' · '),
            columns
        ),
        signedIn.cloudProject === null
            ? line([
                  span(
                      'amber',
                      '  This organization has no Cloud project for Dexto models to bill.'
                  ),
              ])
            : line([span('dim', `  Dexto models bill Cloud project ${signedIn.cloudProject}.`)]),
        ...(signedIn.notCurrent
            ? rowOrRows(
                  [
                      [
                          span('dim', 'Other commands still use another profile: pass '),
                          span('teal', `--profile ${signedIn.profile}`),
                          span('dim', ','),
                      ],
                      [
                          span('dim', 'or run '),
                          span('teal', `dexto accounts use ${signedIn.profile}`),
                      ],
                  ],
                  span('dim', ' '),
                  columns
              )
            : []),
        '',
        line([span('fg', '  Now available:')]),
        ...cloudAddsLines(columns, 2),
        '',
        line([
            span('dim', '  next: '),
            span('teal', 'dexto'),
            span('dim', '  ·  chat sync is opt-in: /sync on saves chats to Dexto Cloud'),
        ]),
    ];
}

/** At a terminal on Signal, the Signal screens on stderr; the plain notes anywhere else. */
export function terminalSignInScreen(
    write: (text: string) => void,
    note: (text: string) => void,
    json: boolean
): SignInScreen {
    // These screens go to stderr, so stderr has to be the terminal, and its caps draw them.
    if (json || !signalOn() || process.stderr.isTTY !== true) return plainSignInScreen(note);
    return signalSignInScreen(
        write,
        process.stderr.columns ?? 80,
        Date.now,
        capsFor(process.stderr)
    );
}

const CLEAR_LINE = '\r\u001B[2K';

/**
 * Prints a prompt to stderr and keeps its waiting line live until the sign-in settles. On
 * success the code fades. Without a terminal the waiting line is left out. `caps` are the
 * stream's (stderr's); null draws with the process caps. The signed-in text is a result for
 * stdout, so it keeps the process caps.
 */
export function signalSignInScreen(
    write: (text: string) => void,
    columns: number,
    now: () => number = Date.now,
    caps: Caps | null = null
): SignInScreen {
    const on = <T>(draw: () => T): T => (caps === null ? draw() : drawOn(caps, draw));
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
            const lines = on(() =>
                prompt.kind === 'device' ? devicePromptLines(prompt) : browserPromptLines(prompt)
            );
            write(`${lines.join('\n')}\n`);
            // A row that wraps breaks the in-place redraw, so a narrow terminal gets no live line.
            const widest = Math.max(...lines.map(drawnWidth));
            if (!on(richOutput) || widest > columns) return;
            process.once('SIGINT', onInterrupt);
            const started = now();
            let tick = 0;
            const draw = () =>
                write(`${CLEAR_LINE}${on(() => waitingLine(prompt, now() - started, tick++))}`);
            draw();
            timer = setInterval(draw, 100);
        },
        settle(signedIn: boolean): void {
            if (timer === null) return;
            clearInterval(timer);
            timer = null;
            process.off('SIGINT', onInterrupt);
            write(CLEAR_LINE);
            // The Code row, then From, Access and a blank row, then this line: fade it in place.
            const code = shown;
            if (!signedIn || code?.kind !== 'device') return;
            const faded = on(() => codeRow(code.userCode, true));
            write(`\u001B[4A${CLEAR_LINE}${faded}\n\n\n\n`);
        },
    };
}
