import * as p from '@clack/prompts';
import chalk from 'chalk';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const AGENTS_FILENAME = 'AGENTS.md';
const WORKSPACE_DIRECTORIES = ['agents', 'skills'] as const;

const DEFAULT_AGENTS_MD = `# Dexto Workspace

This workspace can define project-specific agents and skills.

## Structure
- Put custom agents and subagents in \`agents/\`
- Put custom skills in \`skills/<skill-id>/SKILL.md\`
- Use \`.dexto/\` only for Dexto-managed state and installed assets

## Defaults
- If no workspace agent is defined, Dexto uses your global default agent locally
- Cloud deploys without a workspace agent use the managed cloud default agent
`;

type ScaffoldEntryStatus = 'created' | 'existing';

export interface WorkspaceScaffoldResult {
    root: string;
    agentsFile: { path: string; status: ScaffoldEntryStatus };
    directories: Array<{ path: string; status: ScaffoldEntryStatus }>;
}

async function ensureWorkspaceRoot(root: string): Promise<void> {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
        throw new Error(`${root} exists and is not a directory`);
    }
}

async function getExistingEntryType(entryPath: string): Promise<'missing' | 'file' | 'directory'> {
    try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
            return 'directory';
        }
        if (stat.isFile()) {
            return 'file';
        }
        return 'file';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return 'missing';
        }
        throw error;
    }
}

async function ensureDirectory(dirPath: string): Promise<ScaffoldEntryStatus> {
    try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
            throw new Error(`${dirPath} exists and is not a directory`);
        }
        return 'existing';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.mkdir(dirPath, { recursive: true });
    return 'created';
}

async function ensureFile(filePath: string, content: string): Promise<ScaffoldEntryStatus> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
            throw new Error(`${filePath} exists and is not a file`);
        }
        return 'existing';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return 'created';
}

export async function createWorkspaceScaffold(
    workspaceRoot: string = process.cwd()
): Promise<WorkspaceScaffoldResult> {
    const root = path.resolve(workspaceRoot);
    const agentsFilePath = path.join(root, AGENTS_FILENAME);
    await ensureWorkspaceRoot(root);

    const agentsFileType = await getExistingEntryType(agentsFilePath);
    if (agentsFileType === 'directory') {
        throw new Error(`${agentsFilePath} exists and is not a file`);
    }

    for (const directory of WORKSPACE_DIRECTORIES) {
        const dirPath = path.join(root, directory);
        const entryType = await getExistingEntryType(dirPath);
        if (entryType === 'file') {
            throw new Error(`${dirPath} exists and is not a directory`);
        }
    }

    const agentsFileStatus = await ensureFile(agentsFilePath, DEFAULT_AGENTS_MD);

    const directories: WorkspaceScaffoldResult['directories'] = [];
    for (const directory of WORKSPACE_DIRECTORIES) {
        const dirPath = path.join(root, directory);
        const status = await ensureDirectory(dirPath);
        directories.push({ path: dirPath, status });
    }

    return {
        root,
        agentsFile: { path: agentsFilePath, status: agentsFileStatus },
        directories,
    };
}

function formatCreatedPaths(result: WorkspaceScaffoldResult): string[] {
    const createdPaths: string[] = [];

    if (result.agentsFile.status === 'created') {
        createdPaths.push(path.relative(result.root, result.agentsFile.path) || AGENTS_FILENAME);
    }

    for (const directory of result.directories) {
        if (directory.status === 'created') {
            createdPaths.push(
                path.relative(result.root, directory.path) || path.basename(directory.path)
            );
        }
    }

    return createdPaths;
}

export async function handleInitCommand(workspaceRoot: string = process.cwd()): Promise<void> {
    p.intro(chalk.inverse('Dexto Init'));

    const result = await createWorkspaceScaffold(workspaceRoot);
    const createdPaths = formatCreatedPaths(result);

    if (createdPaths.length === 0) {
        p.outro(chalk.green('Workspace already initialized.'));
        return;
    }

    p.note(createdPaths.map((item) => `- ${item}`).join('\n'), 'Created');
    p.outro(chalk.green('Workspace initialized.'));
}
