import { stat } from 'node:fs/promises';
import path from 'node:path';
import { open, type Entry } from 'yauzl';
import { z } from 'zod';
import { UsageError } from '../cloud/command.js';
import { redactSecrets, toImportInput } from './redaction.js';
import { toolCallText, toolResultText } from './transcript.js';

const MAX_JSON_BYTES = 128 * 1024 * 1024;
const DateSchema = z.iso.datetime({ offset: true });
const BlockSchema = z.object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    content: z.unknown().optional(),
});
const MessageSchema = z.object({
    sender: z.enum(['human', 'assistant']),
    created_at: DateSchema,
    text: z.string().default(''),
    content: z.array(BlockSchema).default([]),
    attachments: z
        .array(z.object({ file_name: z.string(), extracted_content: z.string().optional() }))
        .default([]),
});
const ConversationsSchema = z.array(
    z.object({
        uuid: z.uuid(),
        name: z.string(),
        created_at: DateSchema,
        updated_at: DateSchema,
        project_uuid: z.uuid().nullable().optional(),
        chat_messages: z.array(MessageSchema).min(1),
    })
);
const ProjectsSchema = z.array(
    z.object({
        uuid: z.uuid(),
        name: z.string().min(1),
        created_at: DateSchema,
        updated_at: DateSchema,
        docs: z
            .array(z.object({ uuid: z.uuid(), filename: z.string().min(1), content: z.string() }))
            .default([]),
    })
);

/** Reads metadata only, never extracts archive paths or opens account/credential files. */
async function metadata(archive: string): Promise<Map<string, string>> {
    const size = await stat(archive).catch(() => null);
    if (size === null || !size.isFile() || size.size > 512 * 1024 * 1024)
        throw new UsageError('Give a readable Claude export ZIP no larger than 512 MiB.');
    return new Promise((resolve, reject) => {
        open(archive, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
            if (error !== null || zip === undefined) {
                reject(new UsageError('Cannot read the Claude export ZIP.'));
                return;
            }
            const files = new Map<string, string>();
            let entries = 0;
            const fail = () => {
                zip.close();
                reject(new UsageError('Invalid or oversized Claude export ZIP metadata.'));
            };
            zip.on('error', fail);
            zip.on('end', () => resolve(files));
            zip.on('entry', (entry: Entry) => {
                if (++entries > 10_000) {
                    fail();
                    return;
                }
                const name = path.posix.basename(entry.fileName);
                if (name !== 'conversations.json' && name !== 'projects.json') {
                    zip.readEntry();
                    return;
                }
                if (
                    files.has(name) ||
                    entry.uncompressedSize > MAX_JSON_BYTES ||
                    (entry.generalPurposeBitFlag & 1) !== 0
                ) {
                    fail();
                    return;
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError !== null || stream === undefined) {
                        fail();
                        return;
                    }
                    const chunks: Buffer[] = [];
                    let bytes = 0;
                    stream.on('data', (chunk: Buffer) => {
                        bytes += chunk.length;
                        if (bytes > MAX_JSON_BYTES) {
                            stream.destroy();
                            fail();
                            return;
                        }
                        chunks.push(chunk);
                    });
                    stream.on('error', fail);
                    stream.on('end', () => {
                        files.set(name, Buffer.concat(chunks).toString('utf8'));
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });
}

function readJson<T>(schema: z.ZodType<T>, text: string, name: string): T {
    try {
        return schema.parse(JSON.parse(text));
    } catch {
        throw new UsageError(
            `Unsupported Claude export ${name}; expected the documented UUID/timestamp/message structure.`
        );
    }
}

/** Structured blocks take precedence over the legacy text field; do not duplicate both. */
function messageText(message: z.output<typeof MessageSchema>): string {
    const blocks = message.content.flatMap((block) => {
        if (block.type === 'text' && block.text) return [block.text];
        if (block.type === 'thinking' && block.thinking) return [`**Thinking**\n${block.thinking}`];
        if (block.type === 'tool_use') return [toolCallText(block.name ?? 'unknown', block.input)];
        if (block.type === 'tool_result')
            return [
                toolResultText(
                    typeof block.content === 'string'
                        ? block.content
                        : JSON.stringify(block.content ?? null)
                ),
            ];
        return [];
    });
    const text = blocks.length > 0 ? blocks.join('\n\n') : message.text;
    return [
        text,
        ...message.attachments.flatMap((item) =>
            item.extracted_content
                ? [`**Attachment: ${item.file_name}**\n${item.extracted_content}`]
                : []
        ),
    ]
        .filter(Boolean)
        .join('\n\n');
}

export async function readClaudeExport(archive: string) {
    const files = await metadata(archive);
    const conversations = files.get('conversations.json');
    if (conversations === undefined)
        throw new UsageError(
            'This ZIP has no conversations.json. Download the Claude conversation export ZIP.'
        );
    const chats = readJson(ConversationsSchema, conversations, 'conversations.json');
    const rawProjects = files.get('projects.json');
    const projects =
        rawProjects === undefined ? [] : readJson(ProjectsSchema, rawProjects, 'projects.json');
    for (const ids of [chats.map((chat) => chat.uuid), projects.map((project) => project.uuid)])
        if (new Set(ids).size !== ids.length)
            throw new UsageError('The Claude export contains duplicate source IDs.');
    const projectIds = new Set(projects.map((project) => project.uuid));
    const sessions = chats.map((chat) => {
        if (chat.project_uuid && !projectIds.has(chat.project_uuid))
            throw new UsageError(
                'A Claude conversation names a Project absent from projects.json.'
            );
        const prepared = toImportInput({
            cwd: null,
            gitBranch: null,
            id: chat.uuid,
            source: 'claude-export',
            title: chat.name,
            messages: chat.chat_messages
                .map((message) => ({
                    createdAt: message.created_at,
                    role: message.sender === 'human' ? ('user' as const) : ('assistant' as const),
                    text: messageText(message),
                }))
                .filter((message) => message.text.trim() !== ''),
        });
        if (prepared.kind === 'skipped' || prepared.input.messages.length === 0)
            throw new UsageError('A Claude conversation has no supported messages.');
        return {
            id: chat.uuid,
            status: 'ready' as const,
            projectSourceId: chat.project_uuid ?? null,
            input: {
                ...prepared.input,
                importerVersion: 'claude-export-v1',
                sourceCreatedAt: chat.created_at,
                sourceUpdatedAt: chat.updated_at,
            },
            redactions: prepared.redactions,
            leftOut: prepared.leftOut,
            truncated: prepared.truncated,
        };
    });
    return {
        sessions,
        projects: projects.map((project) => ({
            sourceId: project.uuid,
            sourceKey: `claude-export:project:${project.uuid}`,
            name: redactSecrets(project.name).text.slice(0, 100),
            files: project.docs
                .filter(
                    (doc) =>
                        !['claude.md', 'agents.md', 'memory.md'].includes(
                            path.posix.basename(doc.filename.replaceAll('\\', '/')).toLowerCase()
                        )
                )
                .map((doc) => {
                    const name = redactSecrets(
                        path.posix.basename(doc.filename.replaceAll('\\', '/'))
                    )
                        .text.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
                        .slice(0, 180);
                    return {
                        name: `${doc.uuid}-${name}`,
                        text: redactSecrets(doc.content).text,
                    };
                }),
        })),
        notices: [
            'Memories, CLAUDE.md, AGENTS.md and Project instructions are deferred pending the import policy decision.',
            'Chats without an explicit project_uuid remain unassigned; Project membership is never inferred.',
        ],
    };
}
