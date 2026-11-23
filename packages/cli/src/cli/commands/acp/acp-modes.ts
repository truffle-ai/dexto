import type * as acp from '@agentclientprotocol/sdk';
import type { PermissionsMode } from '@dexto/core';
import type { AutoApprovalMode } from '@dexto/tui/host-rules';

/**
 * The TUI's permission modes (Shift+Tab), as ACP session modes. Asks you asks before
 * approval-gated actions; Plan also adds plan mode's instructions to the next prompt and ends when
 * a plan review is approved; Accept edits approves workspace edits; Full access approves tool and
 * command approvals. A request that must always ask still asks in every mode.
 */
const MODES = [
    {
        id: 'asks-you',
        name: 'Asks you',
        description: 'Asks before file edits, commands and other approval-gated actions',
    },
    {
        id: 'plan',
        name: 'Plan',
        description: 'Plans before changing anything, and asks you to approve the plan',
    },
    {
        id: 'accept-edits',
        name: 'Accept edits',
        description: 'Edits files in the project without asking; asks for everything else',
    },
    {
        id: 'full-access',
        name: 'Full access',
        description: 'Runs tools and commands without asking',
    },
] as const satisfies readonly acp.SessionMode[];

type ModeId = (typeof MODES)[number]['id'];

/** A session's mode. Plan remembers whether its instructions were already sent. */
export type SessionMode =
    | { readonly id: 'plan'; readonly instructed: boolean }
    | { readonly id: Exclude<ModeId, 'plan'> };

/** The mode a session starts in: the agent's configured permissions mode. */
export function initialMode(permissionsMode: PermissionsMode): SessionMode {
    return { id: permissionsMode };
}

/** The mode an ACP `modeId` names, or null for an unknown one. */
export function parseMode(modeId: string): SessionMode | null {
    const mode = MODES.find(({ id }) => id === modeId);
    if (mode === undefined) return null;
    return mode.id === 'plan' ? { id: 'plan', instructed: false } : { id: mode.id };
}

export function modeState(mode: SessionMode): acp.SessionModeState {
    return { currentModeId: mode.id, availableModes: [...MODES] };
}

/** How a mode settles approvals without asking, or null when it always asks. */
export function autoApprovalMode(mode: SessionMode, workspace: string): AutoApprovalMode | null {
    switch (mode.id) {
        case 'full-access':
            return { kind: 'full-access' };
        case 'accept-edits':
            return { kind: 'accept-edits', workspace };
        default:
            return null;
    }
}
