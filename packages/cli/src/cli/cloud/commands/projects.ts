// `cloud projects`: the Cloud projects you can act in, and which one commands use.

import { dextoAccounts } from '@dexto/agent-management';
import { unwrap } from '@dexto/cloud-client';
import { argument, UsageError, type Command, type CommandContext } from '../command.js';

async function listProjects(context: CommandContext) {
    return await unwrap(await (await context.client()).GET('/v1/projects'));
}

const list: Command = {
    path: ['cloud', 'projects', 'list'],
    summary: 'List the Cloud projects you can act in; * marks the current one.',
    async run(context) {
        const connection = await context.connection();
        const projects = await listProjects(context);
        context.output.list(projects, [
            {
                header: '',
                value: (project) =>
                    project.id === connection.cloudProject ||
                    (connection.kind === 'api_key' && projects.data.length === 1)
                        ? '*'
                        : '',
            },
            { header: 'id', value: (project) => project.id },
            { header: 'name', value: (project) => project.name },
            { header: 'default', value: (project) => (project.is_default ? 'yes' : '') },
            { header: 'archived', value: (project) => project.archived_at },
        ]);
    },
};

const create: Command = {
    arguments: '<name>',
    path: ['cloud', 'projects', 'create'],
    summary: 'Create a Cloud project. Owners and Admins create projects.',
    async run(context, input) {
        const project = await unwrap(
            await (
                await context.client()
            ).POST('/v1/projects', { body: { name: argument(input, 0, 'name') } })
        );
        context.output.result(
            project,
            `Created Cloud project ${project.name} (${project.id}). Act in it with dexto cloud projects use ${project.id}.`
        );
    },
};

/** Chooses the project a person's sign-in acts in; `accounts` reads the same saved login. */
export function projectsUse(accountsDir: string): Command {
    return {
        arguments: '<project>',
        path: ['cloud', 'projects', 'use'],
        summary: 'Act in this Cloud project, by id or name, from now on. Dexto models bill it too.',
        async run(context, input) {
            const connection = await context.connection();
            if (connection.kind !== 'oauth' || connection.source !== 'login')
                throw new UsageError(
                    'A key acts only in its own project. Sign in with dexto login to choose projects.'
                );
            const wanted = argument(input, 0, 'project');
            const projects = await listProjects(context);
            const matches = projects.data.filter(
                (project) => project.id === wanted || project.name === wanted
            );
            const [project] = matches;
            if (project === undefined) throw new UsageError(`No Cloud project ${wanted}.`);
            if (matches.length > 1)
                throw new UsageError(`More than one project is named ${wanted}; use its id.`);
            if (project.archived_at !== null)
                throw new UsageError(
                    `${project.name} is archived. Restore it in the Cloud app first.`
                );
            await dextoAccounts.writeLogin(accountsDir, connection.profile, {
                ...connection.login,
                cloudProject: { id: project.id, name: project.name },
            });
            context.output.result(
                project,
                `Acting in Cloud project ${project.name} (${project.id}).`
            );
        },
    };
}

export const projectCommands: readonly Command[] = [list, create];
