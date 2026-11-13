import path from 'node:path';
import type { SessionApproval } from '@dexto/core';
import { makeRelativePath } from './messageFormatting.js';

const DIRECTORY_KEY = /^directory:(.+?)(?::operation:(.+))?$/;
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
    const directory = DIRECTORY_KEY.exec(approval.value);
    if (directory?.[1] !== undefined) {
        const verb = directory[2] === undefined ? undefined : DIRECTORY_VERBS[directory[2]];
        return `${verb ?? 'access'} in ${makeRelativePath(directory[1])}`;
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
    const directory = DIRECTORY_KEY.exec(approvalKey);
    const operation = directory?.[2];
    if (directory?.[1] === undefined || (operation !== 'edit' && operation !== 'write')) {
        return false;
    }
    const relative = path.relative(workspace, directory[1]);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
