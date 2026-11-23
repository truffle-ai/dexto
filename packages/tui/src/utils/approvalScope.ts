import path from 'node:path';
import type { SessionApproval } from '@dexto/core';
import { makeRelativePath } from './messageFormatting.js';

const DIRECTORY_PREFIX = 'directory:';
const OPERATION_MARKER = ':operation:';
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * A directory approval key, `directory:<dir>` or `directory:<dir>:operation:<op>`, split at the
 * first operation marker. Parsed without a backtracking regex, since keys come from tool input.
 */
function parseDirectoryKey(
    key: string
): { directory: string; operation: string | undefined } | null {
    if (!key.startsWith(DIRECTORY_PREFIX) || LINE_BREAK.test(key)) return null;
    const rest = key.slice(DIRECTORY_PREFIX.length);
    if (rest.length === 0) return null;
    const at = rest.indexOf(OPERATION_MARKER, 1);
    if (at === -1 || at + OPERATION_MARKER.length === rest.length) {
        return { directory: rest, operation: undefined };
    }
    return { directory: rest.slice(0, at), operation: rest.slice(at + OPERATION_MARKER.length) };
}
const DIRECTORY_VERBS: Readonly<Record<string, string>> = {
    read: 'reads',
    edit: 'edits',
    write: 'writes',
};

export function formatApprovalScope(approval: SessionApproval): string {
    if (approval.kind === 'tool') return `tool ${approval.value}`;
    if (approval.value.startsWith('bash:exact:')) {
        return `this exact command (${approval.value.slice(-8)})`;
    }
    if (approval.value.startsWith('bash:')) return approval.value.slice(5);
    const key = parseDirectoryKey(approval.value);
    if (key !== null) {
        const verb = key.operation === undefined ? undefined : DIRECTORY_VERBS[key.operation];
        return `${verb ?? 'access'} in ${makeRelativePath(key.directory)}`;
    }
    return approval.value;
}

/**
 * Whether "accept edits" may settle an edit request with this approval key: a keyless request,
 * or a write or edit key for a directory inside the workspace. Asks you gives workspace edits a
 * directory key too, so a session approval stays scoped to that directory; edits outside the
 * workspace keep asking. `workspace` must be canonical, like the directory in the key.
 */
export function isEditInWorkspace(approvalKey: string | undefined, workspace: string): boolean {
    if (approvalKey === undefined) return true;
    const key = parseDirectoryKey(approvalKey);
    if (key === null || (key.operation !== 'edit' && key.operation !== 'write')) return false;
    const relative = path.relative(workspace, key.directory);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
