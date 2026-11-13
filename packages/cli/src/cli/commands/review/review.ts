import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolveBundledScript } from '@dexto/agent-management';
import { CommandFailure } from '../../failure.js';

/** Runs git with these arguments in the repository; resolves stdout, rejects on a non-zero exit. */
export type GitRunner = (args: readonly string[]) => Promise<string>;

/** Branches tried, in order, when no --base is given and the current branch has no upstream. */
const DEFAULT_BASES = ['main', 'origin/main'] as const;

/** Diff text beyond this is cut; the agent can still read the files with its own tools. */
export const MAX_REVIEW_DIFF_CHARS = 400_000;

/** The bundled review skill the prompt is built on. */
const REVIEW_SKILL_PATH = 'agents/coding-agent/skills/code-review.md';

export interface ReviewChanges {
    /** The ref the changes are measured against, as the user would type it. */
    readonly base: string;
    readonly mergeBase: string;
    /** Committed and uncommitted changes to tracked files since `mergeBase`. */
    readonly diff: string;
    /** New files git doesn't track yet, which `diff` leaves out. */
    readonly untracked: readonly string[];
}

export function gitIn(cwd: string): GitRunner {
    const run = promisify(execFile);
    return async (args) =>
        (await run('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
            .stdout;
}

async function succeeds(git: GitRunner, args: readonly string[]): Promise<string | null> {
    try {
        return (await git(args)).trim();
    } catch {
        return null;
    }
}

/**
 * The ref to review against: --base when given, else the current branch's upstream, else the
 * first of DEFAULT_BASES that exists.
 */
async function resolveBase(git: GitRunner, base: string | undefined): Promise<string> {
    if (base !== undefined) return base;
    const upstream = await succeeds(git, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
    ]);
    if (upstream !== null && upstream.length > 0) return upstream;
    for (const candidate of DEFAULT_BASES) {
        if (
            (await succeeds(git, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])) !==
            null
        )
            return candidate;
    }
    throw new CommandFailure(
        'not_found',
        'No base to review against: this branch has no upstream and there is no main branch.',
        'dexto review --base <branch>'
    );
}

/** Everything that changed since the current branch left `base`, including uncommitted work. */
export async function collectReviewChanges(
    git: GitRunner,
    options: { base: string | undefined }
): Promise<ReviewChanges> {
    if ((await succeeds(git, ['rev-parse', '--is-inside-work-tree'])) !== 'true') {
        throw new CommandFailure(
            'invalid_input',
            'Not inside a git repository. Run dexto review from the repository to review.',
            null
        );
    }
    const base = await resolveBase(git, options.base);
    const mergeBase = await succeeds(git, ['merge-base', base, 'HEAD']);
    if (mergeBase === null || mergeBase.length === 0) {
        throw new CommandFailure(
            'not_found',
            `Can't find where this branch left ${base}.`,
            'dexto review --base <branch>'
        );
    }
    const diff = await git(['diff', '--no-color', '--no-ext-diff', mergeBase]);
    const untracked = (await git(['ls-files', '--others', '--exclude-standard']))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    return { base, mergeBase, diff, untracked };
}

export function hasChanges(changes: ReviewChanges): boolean {
    return changes.diff.trim().length > 0 || changes.untracked.length > 0;
}

/** The skill's instructions without its frontmatter. */
export function skillBody(markdown: string): string {
    const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
    return (match === null ? markdown : markdown.slice(match[0].length)).trim();
}

export async function readBundledReviewSkill(): Promise<string> {
    return skillBody(await readFile(resolveBundledScript(REVIEW_SKILL_PATH), 'utf8'));
}

/** The review skill, then the changes to review; a headless run has no one to ask what to review. */
export function buildReviewPrompt(
    skill: string,
    changes: ReviewChanges,
    focus: string | undefined
): string {
    const truncated = changes.diff.length > MAX_REVIEW_DIFF_CHARS;
    const diff = truncated ? changes.diff.slice(0, MAX_REVIEW_DIFF_CHARS) : changes.diff;
    return [
        skill,
        '---',
        `Review the changes on the current branch since it left \`${changes.base}\` (merge base ${changes.mergeBase}), including uncommitted work. They are below; don't ask what to review. Read the surrounding files when the diff alone isn't enough, and don't change any files.`,
        ...(focus === undefined ? [] : [`Focus area: ${focus}`]),
        ...(changes.untracked.length === 0
            ? []
            : [
                  `New files not yet tracked by git (read them yourself):\n${changes.untracked.map((file) => `- ${file}`).join('\n')}`,
              ]),
        ...(diff.trim().length === 0 ? [] : [`\`\`\`diff\n${diff.replace(/\n$/, '')}\n\`\`\``]),
        ...(truncated
            ? [
                  `The diff was cut at ${MAX_REVIEW_DIFF_CHARS} characters; run \`git diff ${changes.mergeBase}\` to read the rest.`,
              ]
            : []),
    ].join('\n\n');
}
