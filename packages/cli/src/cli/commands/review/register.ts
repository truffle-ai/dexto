import { withAnalytics } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';
import { runHeadlessPrompt } from '../run/headless-command.js';
import { buildReviewPrompt, collectReviewChanges, hasChanges, type GitRunner } from './review.js';

export const NOTHING_TO_REVIEW = 'Nothing to review.';

export interface ReviewCommandDeps {
    readonly git: GitRunner;
    readonly readSkill: () => Promise<string>;
}

export function registerReviewCommand(
    context: RuntimeCommandRegisterContext,
    deps: ReviewCommandDeps
): void {
    context.program
        .command('review')
        .description('Review the current branch and uncommitted changes, and print the review')
        .option('--base <ref>', 'Review changes since this branch (default: upstream, else main)')
        .option('--focus <area>', 'What to look at hardest, e.g. security or performance')
        .option('-m, --model <model>', 'Specify the LLM model to use for this review')
        .option('--json', 'Print one JSON result (the default when stdout is not a terminal)')
        .option('--stream-json', 'Print JSON events, one per line, ending with one result')
        .option('--text', 'Print only the review (the default at a terminal)')
        .addHelpText(
            'after',
            `
Reviews what changed since the branch left its base, plus uncommitted and untracked files.
The agent reads files but is asked not to change them.

Examples:
  $ dexto review
  $ dexto review --base origin/cli-2.0 --focus security
  $ dexto review --json | jq -r .content

With no changes it prints "${NOTHING_TO_REVIEW}" and exits 0 without starting an agent.
Exit codes: 0 done, 1 failed, 2 usage, 3 needs sign-in or permission, 4 needs confirmation,
5 not found, 6 waiting on a person.
`
        )
        .action(
            withAnalytics(
                'review',
                async (options: {
                    base?: string;
                    focus?: string;
                    model?: string;
                    json?: boolean;
                    streamJson?: boolean;
                    text?: boolean;
                }) => {
                    await runHeadlessPrompt(context, {
                        command: 'review',
                        options,
                        preparePrompt: async () => {
                            const changes = await collectReviewChanges(deps.git, {
                                base: options.base,
                            });
                            if (!hasChanges(changes))
                                return { kind: 'no_work', message: NOTHING_TO_REVIEW };
                            return {
                                kind: 'prompt',
                                prompt: buildReviewPrompt(
                                    await deps.readSkill(),
                                    changes,
                                    options.focus
                                ),
                            };
                        },
                    });
                }
            )
        );
}
