import { CommandFailure } from '../failure.js';

export type SkillClashPolicy = 'ask' | 'skip' | 'rename';

/** An existing skill is never overwritten; automated callers must select a policy. */
export async function chooseSkillClash(options: {
    readonly policy: SkillClashPolicy;
    readonly json: boolean;
    readonly prompt: ((question: string, options: { secret: boolean }) => Promise<string>) | null;
}): Promise<'skip' | 'rename'> {
    if (options.policy !== 'ask') return options.policy;
    if (!options.json && options.prompt !== null) {
        const answer = (
            await options.prompt('Skill already exists. Skip or rename? ', { secret: false })
        )
            .trim()
            .toLowerCase();
        if (answer === 'skip' || answer === 'rename') return answer;
    }
    throw new CommandFailure(
        'needs_confirmation',
        'Choose how to handle the existing skill.',
        'Rerun with --on-clash skip or --on-clash rename.'
    );
}
