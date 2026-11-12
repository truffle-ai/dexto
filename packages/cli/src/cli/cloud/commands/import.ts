import path from 'node:path';

import { z } from 'zod';

import { claudeCodeFolder } from '../../import/claude-code.js';
import {
    projectFolder,
    readClaudeCodeProject,
    type ClaudeCodeProjectInput,
} from '../../import/claude-code-knowledge.js';
import { findLocalChats } from '../../import/local-chats.js';
import { findPersonalSkills } from '../../import/personal-skills.js';
import { redactSecrets, toImportInput } from '../../import/redaction.js';
import { LOCAL_CHAT_SOURCES, type LocalChat } from '../../import/transcript.js';
import { CommandFailure, EXIT_CODES } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    flag,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { sendTranscript } from './import-client.js';
import { queryWorkspaceTool } from './workspace.js';
import {
    importPersonalSkill,
    personalSkillId,
    preparePersonalSkill,
    requireSkillProvenance,
    selectPersonalSkillSlug,
} from './import-skills.js';

const options = {
    select: {
        type: 'string',
        valueName: 'IDS',
        description: 'Comma-separated source:id values, or all.',
    },
    'current-session': {
        type: 'boolean',
        description: 'Select the current Claude Code or Codex session when its ID is available.',
    },
    'dry-run': { type: 'boolean', description: 'Preview redactions without uploading.' },
    'on-clash': {
        type: 'string',
        valueName: 'ask|skip|rename',
        description: 'How to handle an existing personal skill.',
    },
    ...YES_OPTION,
} as const;

function key(chat: LocalChat): string {
    return `${chat.source}:${chat.id}`;
}

const ProjectImportedSchema = z.object({
    project: z.object({ id: z.string() }),
    savedMemories: z.number(),
    status: z.enum(['imported', 'already_imported']),
});

/** One Project per folder the chosen Claude Code chats ran in, holding its memory and instructions. */
interface ProjectPlan {
    readonly chats: readonly LocalChat[];
    readonly input: ClaudeCodeProjectInput;
}

async function planClaudeCodeProjects(
    context: CommandContext,
    chats: readonly LocalChat[]
): Promise<ProjectPlan[]> {
    const byFolder = new Map<string, LocalChat[]>();
    for (const chat of chats) {
        const folder = chat.source === 'claude-code' ? projectFolder(chat) : null;
        if (folder === null) continue;
        byFolder.set(folder, [...(byFolder.get(folder) ?? []), chat]);
    }
    const { environment, homeDirectory } = context.runtime;
    const configDir = path.dirname(claudeCodeFolder(environment, homeDirectory));
    return await Promise.all(
        [...byFolder].map(async ([folder, folderChats]) => ({
            chats: folderChats,
            input: await readClaudeCodeProject(folder, folderChats, configDir),
        }))
    );
}

function projectPreview(plan: ProjectPlan) {
    return {
        name: plan.input.name,
        sessions: plan.chats.map(key),
        memories: plan.input.memories?.length ?? 0,
        instructions: plan.input.instructions !== undefined,
    };
}

async function runImport(
    context: CommandContext,
    input: CommandInput,
    listOnly: boolean
): Promise<number> {
    const selection = stringOption(input, 'select');
    const current = flag(input, 'current-session');
    if (selection !== undefined && current)
        throw new UsageError('Pass --select or --current-session, not both.');
    const clash = stringOption(input, 'on-clash') ?? 'ask';
    if (clash !== 'ask' && clash !== 'skip' && clash !== 'rename')
        throw new UsageError('--on-clash must be ask, skip or rename.');
    const codexId = current ? context.runtime.environment.CODEX_THREAD_ID : undefined;
    const claudeId = current ? context.runtime.environment.CLAUDE_CODE_SESSION_ID : undefined;
    if (codexId && claudeId)
        throw new UsageError(
            'Multiple current sessions are present. Select a source:id explicitly with --select.'
        );
    const currentKey = codexId ? `codex:${codexId}` : claudeId ? `claude-code:${claudeId}` : null;
    if (current && currentKey === null)
        throw new UsageError(
            'Cannot identify the current session. Select a source:id explicitly with --select.'
        );
    const scans = await Promise.all(
        LOCAL_CHAT_SOURCES.map((source) =>
            findLocalChats(context.runtime, { source, dir: null, folder: null, since: null })
        )
    );
    for (const scan of scans)
        for (const notice of scan.notices) context.output.note(notice.message);
    const chats = scans.flatMap((scan) => scan.chats);
    const personalSkills = await findPersonalSkills(context.runtime.homeDirectory);
    if (listOnly || (selection === undefined && !current)) {
        const skills = personalSkills.map((skill) => {
            const name = redactSecrets(skill.name).text;
            return {
                id: personalSkillId(skill),
                source: skill.source,
                name,
                status: 'available' as const,
            };
        });
        const sessions = chats.map((chat) => ({
            id: key(chat),
            source: chat.source,
            title: redactSecrets(chat.title).text,
            cwd: chat.cwd === null ? null : redactSecrets(chat.cwd).text,
            messages: chat.messages.length,
            updatedAt: chat.updatedAt,
        }));
        context.output.result(
            { sessions, skills },
            [
                ...sessions.map((item) => `${item.id} ${item.title}`),
                ...skills.map((item) => `${item.id} ${item.name}`),
            ].join('\n')
        );
        return 0;
    }
    const ids = currentKey
        ? [currentKey]
        : selection === 'all'
          ? [...chats.map(key), ...personalSkills.map(personalSkillId)]
          : (selection ?? '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean);
    if (ids.length === 0 && selection === 'all') {
        context.output.result({ sessions: [] }, 'No local sessions found.');
        return 0;
    }
    if (ids.length === 0 || new Set(ids).size !== ids.length)
        throw new UsageError('Select one or more distinct source:id values, or all.');
    const chosenSkills = ids
        .filter((id) => id.startsWith('skill:'))
        .map((id) => {
            const skill = personalSkills.find((item) => personalSkillId(item) === id);
            if (skill === undefined)
                throw new UsageError('Skill was not found; run dexto import list --json.');
            return skill;
        });
    const chosen = ids
        .filter((id) => !id.startsWith('skill:'))
        .map((id) => {
            const chat = chats.find((item) => key(item) === id);
            if (chat === undefined)
                throw new UsageError(`Session ${id} was not found; run dexto import list --json.`);
            return chat;
        });
    const planned = chosen.map((chat) => ({ chat, prepared: toImportInput(chat) }));
    const projectPlans = await planClaudeCodeProjects(
        context,
        planned.flatMap(({ chat, prepared }) => (prepared.kind === 'ready' ? [chat] : []))
    );
    const skillPlans = await Promise.all(
        chosenSkills.map(async (skill) => ({ skill, prepared: await preparePersonalSkill(skill) }))
    );
    const preview = planned.map(({ chat, prepared }) =>
        prepared.kind === 'skipped'
            ? { id: key(chat), status: 'skipped', reason: prepared.reason }
            : {
                  id: key(chat),
                  status: 'ready',
                  messages: prepared.input.messages.length,
                  redactions: prepared.redactions,
                  truncated: prepared.truncated,
                  leftOut: prepared.leftOut,
              }
    );
    if (flag(input, 'dry-run')) {
        const sessions = preview.map((item, index) => {
            const prepared = planned[index]?.prepared;
            return prepared?.kind === 'ready' ? { ...item, payload: prepared.input } : item;
        });
        const skills = skillPlans.map(({ skill, prepared }) => ({
            id: personalSkillId(skill),
            status: 'ready',
            files: prepared.files,
            redactions: prepared.redactions,
        }));
        const projects = projectPlans.map((plan) => ({
            ...projectPreview(plan),
            payload: plan.input,
        }));
        const report = { sessions, projects, skills };
        context.output.result(report, JSON.stringify(report, null, 2));
        return planned.some(({ prepared }) => prepared.kind === 'skipped') ? 1 : 0;
    }
    if (planned.some(({ prepared }) => prepared.kind === 'skipped')) {
        context.output.result({ sessions: preview }, JSON.stringify(preview, null, 2));
        return 1;
    }
    await requireConsent(
        context,
        flag(input, 'yes'),
        `Upload ${chosen.length} locally redacted chats, ${projectPlans.length} Projects with their Claude Code memory notes and instructions, and ${chosenSkills.length} personal skills to Dexto?`
    );
    if (skillPlans.length > 0) requireSkillProvenance();
    const reserved = new Set<string>();
    const selectedSkills = [];
    for (const item of skillPlans)
        selectedSkills.push({
            ...item,
            slug: await selectPersonalSkillSlug(context, item.prepared, clash, reserved),
        });
    // Projects first, so each chat goes into its folder's. A chat whose Project failed is still
    // imported, on its own.
    const projects = [];
    const projectOf = new Map<LocalChat, string>();
    for (const plan of projectPlans) {
        try {
            const imported = ProjectImportedSchema.parse(
                await queryWorkspaceTool(context, 'dexto_project_import', plan.input)
            );
            for (const chat of plan.chats) projectOf.set(chat, imported.project.id);
            projects.push({
                ...projectPreview(plan),
                id: imported.project.id,
                status: imported.status,
                savedMemories: imported.savedMemories,
            });
        } catch (error) {
            if (
                error instanceof CommandFailure &&
                (error.kind === 'needs_sign_in' || error.kind === 'needs_permission')
            )
                throw error;
            projects.push({ ...projectPreview(plan), status: 'failed', reason: 'Import failed.' });
        }
    }
    const results = [];
    for (const [index, { chat, prepared }] of planned.entries()) {
        if (prepared.kind !== 'ready') continue;
        const chatProjectId = projectOf.get(chat);
        try {
            const result = await sendTranscript(context, {
                kind: 'text',
                input: {
                    ...prepared.input,
                    ...(chatProjectId === undefined ? {} : { chatProjectId }),
                },
            });
            results.push({ id: key(chat), ...result });
        } catch (error) {
            if (
                error instanceof CommandFailure &&
                (error.kind === 'needs_sign_in' || error.kind === 'needs_permission')
            ) {
                if (results.length === 0) throw error;
                results.push({
                    id: key(chat),
                    status: 'failed',
                    reason: 'Sign-in or permission required.',
                });
                for (const remaining of planned.slice(index + 1))
                    results.push({
                        id: key(remaining.chat),
                        status: 'not_attempted',
                        reason: 'Sign-in or permission required.',
                    });
                const report = {
                    sessions: results,
                    projects,
                    error: {
                        code: error.kind,
                        message: 'Sign-in or permission required.',
                        ...(error.fix === null ? {} : { fix: error.fix }),
                    },
                };
                context.output.result(report, JSON.stringify(report, null, 2));
                return EXIT_CODES[error.kind];
            }
            results.push({ id: key(chat), status: 'failed', reason: 'Import failed.' });
        }
    }
    const skills = [];
    for (const { skill, prepared, slug } of selectedSkills) {
        if (slug === null) {
            skills.push({
                id: personalSkillId(skill),
                status: 'skipped',
                reason: 'Skill already exists.',
            });
            continue;
        }
        try {
            skills.push(await importPersonalSkill(context, skill, prepared, slug));
        } catch (error) {
            if (
                error instanceof CommandFailure &&
                (error.kind === 'needs_confirmation' ||
                    error.kind === 'needs_sign_in' ||
                    error.kind === 'needs_permission')
            )
                throw error;
            skills.push({
                id: personalSkillId(skill),
                status: 'failed',
                reason: 'Import failed; check for an existing skill before retrying.',
            });
        }
    }
    const report = { sessions: results, projects, skills };
    context.output.result(report, JSON.stringify(report, null, 2));
    return results.some((result) => result.status === 'failed') ||
        projects.some((item) => item.status === 'failed') ||
        skills.some((item) => item.status === 'failed')
        ? 1
        : 0;
}

const discover: Command = {
    path: ['import'],
    options,
    summary: 'Discover or import local Claude Code and Codex chats.',
    run: (context, input) => runImport(context, input, false),
};
const list: Command = {
    path: ['import', 'list'],
    summary: 'List local chats for import.',
    run: (context, input) => runImport(context, input, true),
};
export const importCommands: readonly Command[] = [discover, list];
