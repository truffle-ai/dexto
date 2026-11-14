import { z } from 'zod';
import type { ChatImportInput } from '../../import/redaction.js';
import type { LocalChatSource } from '../../import/transcript.js';
import { CommandFailure } from '../../failure.js';
import type { CommandContext } from '../command.js';
import { queryWorkspaceTool } from './workspace.js';

/** Provisional native parts: the transport refuses them until the server contract is verified. */
export type NativeImportPart =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'thinking'; readonly text: string }
    | {
          readonly type: 'tool_call';
          readonly callId: string;
          readonly name: string;
          readonly input: unknown;
      }
    | {
          readonly type: 'tool_result';
          readonly callId: string;
          readonly output: unknown;
          readonly isError?: boolean;
      }
    | { readonly type: 'resource'; readonly stagedAttachmentId: string };

export type TranscriptPayload =
    | { readonly kind: 'text'; readonly input: ChatImportInput }
    | {
          readonly kind: 'native';
          readonly input: {
              readonly source: LocalChatSource;
              readonly sourceSessionId: string;
              readonly title: string;
              readonly importId?: string;
              readonly messages: readonly {
                  readonly role: 'user' | 'assistant';
                  readonly createdAt: string;
                  readonly parts: readonly NativeImportPart[];
                  readonly sourceModel?: { readonly modelId: string; readonly provider?: string };
              }[];
          };
      };

export const ImportedSchema = z.object({
    session: z.object({ id: z.string() }),
    status: z.enum(['imported', 'already_imported']),
    url: z.string(),
    /**
     * The Dexto model the chat continues on, and the model of its last imported answer. Absent
     * when the transcript names no model, the chat already continued in Dexto, or the server
     * predates it.
     */
    continuation: z
        .object({
            model: z.string(),
            sourceModel: z.string(),
            reason: z.enum(['same_model', 'unknown_model', 'not_usable']),
        })
        .optional(),
});

export type ImportedChat = z.output<typeof ImportedSchema>;

export async function sendTranscript(
    context: CommandContext,
    payload: TranscriptPayload
): Promise<ImportedChat> {
    if (payload.kind === 'native')
        throw new CommandFailure('failed', 'Native transcript import is not available yet.', null);
    return ImportedSchema.parse(
        await queryWorkspaceTool(context, 'dexto_chat_import', payload.input)
    );
}
