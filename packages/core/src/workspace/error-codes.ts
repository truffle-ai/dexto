export const WorkspaceErrorCodes = {
    PATH_REQUIRED: 'workspace/path_required',
    CURRENT_WORKSPACE_REQUIRED: 'workspace/current_workspace_required',
    HANDLE_PROVIDER_REQUIRED: 'workspace/handle_provider_required',
    FILE_NOT_FOUND: 'workspace/file_not_found',
    PATH_OUTSIDE_WORKSPACE: 'workspace/path_outside_workspace',
} as const;

export type WorkspaceErrorCode = (typeof WorkspaceErrorCodes)[keyof typeof WorkspaceErrorCodes];
