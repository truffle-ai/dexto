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
