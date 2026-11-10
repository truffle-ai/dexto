import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CommandFailure } from '../../failure.js';
import {
    MAX_REVIEW_DIFF_CHARS,
    buildReviewPrompt,
    collectReviewChanges,
    hasChanges,
    skillBody,
    type GitRunner,
} from './review.js';

/** A git that answers from a table keyed by the joined arguments; anything else exits non-zero. */
function fakeGit(answers: Record<string, string>): GitRunner & { calls: string[] } {
    const calls: string[] = [];
    const git = async (args: readonly string[]) => {
        const key = args.join(' ');
        calls.push(key);
        const answer = answers[key];
        if (answer === undefined) throw new Error(`git ${key} failed`);
        return answer;
    };
    return Object.assign(git, { calls });
}

const inRepo = { 'rev-parse --is-inside-work-tree': 'true\n' };
const upstream = { 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/feature\n' };

describe('collectReviewChanges', () => {
    it('diffs from the merge base with the upstream, and lists untracked files', async () => {
        const git = fakeGit({
            ...inRepo,
            ...upstream,
            'merge-base origin/feature HEAD': 'abc123\n',
            'diff --no-color --no-ext-diff abc123': 'diff --git a/x b/x\n+one\n',
            'ls-files --others --exclude-standard': 'new.ts\n\n',
        });
        const changes = await collectReviewChanges(git, { base: undefined });
        expect(changes).toEqual({
            base: 'origin/feature',
            mergeBase: 'abc123',
            diff: 'diff --git a/x b/x\n+one\n',
            untracked: ['new.ts'],
        });
        expect(hasChanges(changes)).toBe(true);
    });

    it('uses --base over the upstream', async () => {
        const git = fakeGit({
            ...inRepo,
            ...upstream,
            'merge-base origin/cli-2.0 HEAD': 'def456\n',
            'diff --no-color --no-ext-diff def456': '',
            'ls-files --others --exclude-standard': '',
        });
        const changes = await collectReviewChanges(git, { base: 'origin/cli-2.0' });
        expect(changes.base).toBe('origin/cli-2.0');
        expect(git.calls).not.toContain('rev-parse --abbrev-ref --symbolic-full-name @{upstream}');
        expect(hasChanges(changes)).toBe(false);
    });

    it('falls back to main, then origin/main, without an upstream', async () => {
        const git = fakeGit({
            ...inRepo,
            'rev-parse --verify --quiet origin/main^{commit}': 'fff\n',
            'merge-base origin/main HEAD': 'fff\n',
            'diff --no-color --no-ext-diff fff': '',
            'ls-files --others --exclude-standard': '',
        });
        expect((await collectReviewChanges(git, { base: undefined })).base).toBe('origin/main');
    });

    it('refuses outside a git repository as invalid input', async () => {
        const failure = await collectReviewChanges(fakeGit({}), { base: undefined }).catch(
            (error: unknown) => error
        );
        expect(failure).toBeInstanceOf(CommandFailure);
        expect(failure).toMatchObject({ kind: 'invalid_input' });
    });

    it('reports an unknown base as not found, with a fix', async () => {
        const failure = await collectReviewChanges(fakeGit(inRepo), { base: 'nope' }).catch(
            (error: unknown) => error
        );
        expect(failure).toMatchObject({ kind: 'not_found', fix: 'dexto review --base <branch>' });
    });

    it('reports no base at all as not found', async () => {
        const failure = await collectReviewChanges(fakeGit(inRepo), { base: undefined }).catch(
            (error: unknown) => error
        );
        expect(failure).toMatchObject({ kind: 'not_found' });
    });
});

describe('buildReviewPrompt', () => {
    const changes = {
        base: 'main',
        mergeBase: 'abc123',
        diff: '+added line\n',
        untracked: ['new.ts'],
    };

    it('puts the skill first, then the changes, untracked files and focus', () => {
        const prompt = buildReviewPrompt('# Skill', changes, 'security');
        expect(prompt.startsWith('# Skill')).toBe(true);
        expect(prompt).toContain('since it left `main` (merge base abc123)');
        expect(prompt).toContain("don't ask what to review");
        expect(prompt).toContain('Focus area: security');
        expect(prompt).toContain('- new.ts');
        expect(prompt).toContain('```diff\n+added line\n```');
    });

    it('leaves out the focus when none is given', () => {
        expect(buildReviewPrompt('# Skill', changes, undefined)).not.toContain('Focus area');
    });

    it('cuts a diff that is too long and says how to read the rest', () => {
        const prompt = buildReviewPrompt(
            '# Skill',
            { ...changes, diff: 'x'.repeat(MAX_REVIEW_DIFF_CHARS + 10) },
            undefined
        );
        expect(prompt).toContain(`cut at ${MAX_REVIEW_DIFF_CHARS} characters`);
        expect(prompt).toContain('git diff abc123');
        expect(prompt).not.toContain('x'.repeat(MAX_REVIEW_DIFF_CHARS + 1));
    });
});

describe('skillBody', () => {
    it('strips the bundled review skill frontmatter', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const skill = readFileSync(
            path.resolve(here, '../../../../../../agents/coding-agent/skills/code-review.md'),
            'utf8'
        );
        const body = skillBody(skill);
        expect(body.startsWith('# Code Review Skill')).toBe(true);
        expect(body).not.toContain('arguments:');
    });

    it('keeps text without frontmatter as it is', () => {
        expect(skillBody('# Plain\n')).toBe('# Plain');
    });
});
