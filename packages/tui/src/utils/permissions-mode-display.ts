import { PERMISSIONS_MODES, PERMISSIONS_MODE_LABELS, type PermissionsMode } from '@dexto/core';

function isPermissionsMode(mode: string): mode is PermissionsMode {
    return PERMISSIONS_MODES.some((known) => known === mode);
}

/**
 * Label for a backend's permissions mode: "Full access" / "Asks you" for a local agent, or the
 * backend's own value (e.g. a cloud backend) when it is not a local mode.
 */
export function formatPermissionsMode(mode: string): string {
    return isPermissionsMode(mode) ? PERMISSIONS_MODE_LABELS[mode] : mode;
}
