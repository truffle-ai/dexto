export const WorkspaceErrorCodes = {
    PATH_REQUIRED: 'workspace/path_required',
} as const;

export type WorkspaceErrorCode = (typeof WorkspaceErrorCodes)[keyof typeof WorkspaceErrorCodes];
