/**
 * The Signal first run (DEXTO-2041 screen 1): the wordmark, what Dexto is, a preflight of this
 * machine, then the two ways on, printed as what to do next. Shown when there is neither a provider
 * key nor a sign-in to start the chat with. Behind DEXTO_PALETTE=signal.
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    getCaps,
    letterspaced,
    line,
    span,
    spansWidth,
    spread,
    strong,
    wordmarkRows,
    wordmarkRowsFor,
    type Span,
} from '@dexto/tui/signal-text';

export interface FirstRunFacts {
    readonly version: string;
    readonly columns: number;
    readonly rows: number;
    /** The folder, with the home folder as ~. */
    readonly cwd: string;
    readonly git: { readonly branch: string; readonly uncommitted: number } | null;
    /** The first provider key found in the environment, and that provider's default model. */
    readonly model: { readonly envKey: string; readonly model: string } | null;
    /** Who this machine is signed in as, or null when signed out. */
    readonly signedInAs: string | null;
}

const NAME_CELLS = 13;

interface Check {
    readonly ok: boolean;
    readonly name: string;
    readonly value: string;
}

function checks(facts: FirstRunFacts): Check[] {
    const caps = getCaps();
    return [
        {
            ok: true,
            name: 'terminal',
            value: `${caps.color} · ${facts.columns}×${facts.rows} · ${caps.glyphs} · ${caps.theme} background`,
        },
        {
            ok: true,
            name: 'workspace',
            value:
                facts.git === null
                    ? `${facts.cwd} · not a git repository`
                    : `${facts.cwd} · git ${facts.git.branch} · ${facts.git.uncommitted} uncommitted`,
        },
        {
            ok: true,
            name: 'local agent',
            value: 'read · edit · write · run · search · web · your MCP servers',
        },
        facts.model === null
            ? { ok: false, name: 'model', value: 'no provider key found' }
            : {
                  ok: true,
                  name: 'model',
                  value: `${facts.model.envKey} found · ${facts.model.model}`,
              },
        facts.signedInAs === null
            ? { ok: false, name: 'cloud', value: 'signed out · local works fully without it' }
            : { ok: true, name: 'cloud', value: `signed in as ${facts.signedInAs}` },
    ];
}

function checkLine(check: Check, columns: number): string[] {
    const left: Span[] = [
        span(check.ok ? 'teal' : 'faint', check.ok ? '▪ ' : '▫ '),
        span('hi', check.name.padEnd(NAME_CELLS)),
        span('dim', check.value),
    ];
    const right = [check.ok ? span('teal', 'OK') : span('faint', 'SKIP')];
    return spread(left, right, Math.max(columns, spansWidth(left) + 4));
}

export function firstRunLines(facts: FirstRunFacts): string[] {
    const height = wordmarkRowsFor(facts.columns, facts.rows);
    const key = (k: string, words: string, command: string): string =>
        line([strong('hi', k), span('dim', ` ${words.padEnd(13)}`), span('teal', command)]);
    return [
        ...(height === null ? [line([strong('hi', 'dexto')])] : wordmarkRows(height)),
        '',
        ...spread(
            [span('fg', 'Local agent harness. Cloud when you sign in.')],
            [span('faint', `dexto ${facts.version} · first run`)],
            facts.columns
        ),
        '',
        line([span('dim', letterspaced('preflight'))]),
        ...checks(facts).flatMap((check) => checkLine(check, facts.columns)),
        '',
        key('1', 'sign in', 'dexto login'),
        key('2', 'or a key', 'export ANTHROPIC_API_KEY=…'),
        '',
    ];
}

const execFileAsync = promisify(execFile);

/** How long the preflight waits on git, for both questions together. */
const GIT_TIMEOUT_MS = 1000;

/**
 * The branch and how many files have changes, or null outside a git repository or when git
 * doesn't answer within `timeoutMs`. Both questions run at once, under the one deadline.
 */
export async function readGit(
    cwd: string,
    timeoutMs: number = GIT_TIMEOUT_MS
): Promise<FirstRunFacts['git']> {
    const signal = AbortSignal.timeout(timeoutMs);
    const run = async (args: string[]) =>
        (await execFileAsync('git', args, { cwd, encoding: 'utf8', signal })).stdout;
    try {
        const [branch, status] = await Promise.all([
            run(['branch', '--show-current']),
            run(['status', '--porcelain']),
        ]);
        return {
            branch: branch.trim() || 'detached',
            uncommitted: status.split('\n').filter(Boolean).length,
        };
    } catch {
        return null;
    }
}

/** `folder` with the home folder as `~`, on any platform's paths; other folders as they are. */
export function homeRelative(
    folder: string,
    home: string = os.homedir(),
    paths: typeof path.posix = path
): string {
    const relative = paths.relative(home, folder);
    if (relative === '') return '~';
    if (relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative))
        return folder;
    return `~${paths.sep}${relative}`;
}

/** This machine's facts for the preflight; the caller says who it is signed in as. */
export async function readFirstRunFacts(
    version: string,
    signedInAs: string | null
): Promise<FirstRunFacts> {
    const [{ LLM_PROVIDERS, getDefaultModelForProvider }, { getPrimaryApiKeyEnvVar }] =
        await Promise.all([import('@dexto/llm'), import('@dexto/agent-management')]);
    let model: FirstRunFacts['model'] = null;
    for (const provider of LLM_PROVIDERS) {
        const envKey = getPrimaryApiKeyEnvVar(provider);
        const found = process.env[envKey];
        const defaultModel = getDefaultModelForProvider(provider);
        if (found !== undefined && found !== '' && defaultModel !== null) {
            model = { envKey, model: `${provider}/${defaultModel}` };
            break;
        }
    }
    return {
        version,
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
        cwd: homeRelative(process.cwd()),
        git: await readGit(process.cwd()),
        model,
        signedInAs,
    };
}
