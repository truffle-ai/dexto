import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { readClaudeExport } from '../../import/claude-export.js';
import { redactSecrets } from '../../import/redaction.js';
import { requireConsent } from '../../interaction.js';
import { CommandFailure } from '../../failure.js';
import {
    argument,
    flag,
    MissingScopeFailure,
    stringOption,
    UsageError,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { putFolderFile } from './drive.js';
import { queryWorkspaceTool } from './workspace.js';

const ProjectSchema = z.object({
    project: z.object({ id: z.uuid() }),
    status: z.enum(['imported', 'already_imported']),
    filesFolder: z.object({ folderId: z.string() }).nullable(),
});
const ChatSchema = z.object({
    session: z.object({ id: z.string() }),
    status: z.enum(['imported', 'already_imported']),
    url: z.string(),
});

export async function importClaudeExport(context: CommandContext, input: CommandInput) {
    for (const option of ['dir', 'folder', 'since'])
        if (stringOption(input, option) !== undefined)
            throw new UsageError(
                `--${option} is for local coding-agent sessions, not a Claude export.`
            );
    const archive = argument(input, 0, 'export.zip');
    const preview = await readClaudeExport(archive);
    const ids = input.positionals.slice(1);
    if (ids.length > 0 && flag(input, 'all'))
        throw new UsageError('Choose session IDs or --all, not both.');
    if (ids.some((id) => !preview.sessions.some((session) => session.id === id)))
        throw new UsageError('A selected chat ID is absent from the Claude export.');
    const sessions =
        ids.length === 0
            ? preview.sessions
            : preview.sessions.filter((session) => ids.includes(session.id));
    const projects =
        ids.length === 0
            ? preview.projects
            : preview.projects.filter((project) =>
                  sessions.some((session) => session.projectSourceId === project.sourceId)
              );
    if (flag(input, 'dry-run')) {
        context.output.record({ ...preview, sessions, projects });
        return 0;
    }
    if (sessions.length === 0 && projects.length === 0) {
        context.output.record({ sessions: [], projects: [], notices: preview.notices });
        return 0;
    }
    await requireLoginScopes(context, [
        'sessions:write',
        ...(projects.length === 0
            ? []
            : ['projects:write', 'projects:read', 'drive:read', 'drive:write']),
    ]);
    await requireConsent(
        context,
        flag(input, 'yes'),
        `Import ${sessions.length} redacted Claude chats and ${projects.length} Projects with ${projects.reduce((n, project) => n + project.files.length, 0)} knowledge files? Review --dry-run first. Memories and instructions are deferred.`
    );
    const importedProjects = new Map<string, string>();
    const projectResults: Record<string, unknown>[] = [];
    const sessionResults: Record<string, unknown>[] = [];
    const failed = (error: unknown): string => {
        // Work has started: do not let scope escalation retry the whole import automatically.
        if (error instanceof MissingScopeFailure)
            throw new CommandFailure(error.kind, error.message, error.fix);
        return redactSecrets(error instanceof Error ? error.message : 'Import failed.').text;
    };
    for (const project of projects) {
        const files: Record<string, unknown>[] = [];
        try {
            const imported = ProjectSchema.parse(
                await queryWorkspaceTool(context, 'dexto_project_import', {
                    sourceAgent: 'claude_export',
                    sourceId: project.sourceId,
                    sourceKey: project.sourceKey,
                    name: project.name,
                    importerVersion: 'claude-export-v1',
                    prepareFiles: project.files.length > 0,
                })
            );
            importedProjects.set(project.sourceId, imported.project.id);
            if (project.files.length > 0) {
                const folder = imported.filesFolder;
                if (folder === null)
                    throw new Error(
                        'The server did not prepare Project Files. Update the cloud import contract before retrying.'
                    );
                const temporary = await mkdtemp(path.join(os.tmpdir(), 'dexto-export-files-'));
                try {
                    for (const file of project.files) {
                        const localPath = path.join(temporary, file.name);
                        await writeFile(localPath, file.text, { mode: 0o600, flag: 'wx' });
                        const saved = await putFolderFile(context, localPath, folder.folderId);
                        files.push({ name: file.name, id: saved.id });
                    }
                } finally {
                    await rm(temporary, { recursive: true, force: true });
                }
            }
            projectResults.push({
                sourceId: project.sourceId,
                id: imported.project.id,
                status: imported.status,
                files,
            });
        } catch (error) {
            projectResults.push({
                sourceId: project.sourceId,
                status: 'failed',
                files,
                reason: failed(error),
            });
        }
    }
    for (const session of sessions) {
        const projectId =
            session.projectSourceId === null ? null : importedProjects.get(session.projectSourceId);
        if (projectId === undefined) {
            sessionResults.push({
                id: session.id,
                status: 'failed',
                reason: 'Its Project could not be imported; rerun the same export to resume.',
            });
            continue;
        }
        try {
            const imported = ChatSchema.parse(
                await queryWorkspaceTool(context, 'dexto_chat_import', {
                    ...session.input,
                    ...(projectId === null ? {} : { chatProjectId: projectId }),
                })
            );
            sessionResults.push({
                id: session.id,
                chatId: imported.session.id,
                status: imported.status,
                url: imported.url,
            });
        } catch (error) {
            sessionResults.push({ id: session.id, status: 'failed', reason: failed(error) });
        }
    }
    context.output.record({
        sessions: sessionResults,
        projects: projectResults,
        notices: preview.notices,
    });
    return [...sessionResults, ...projectResults].some((result) => result.status === 'failed')
        ? 1
        : 0;
}
