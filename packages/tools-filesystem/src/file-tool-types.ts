/**
 * File Tool Types
 *
 * Types shared between file tools for directory approval support.
 */

import type { FileSystemService } from './filesystem-service.js';

/**
 * Callbacks for directory access approval.
 * Allows file tools to check and request approval for accessing paths
 * outside the configured working directory.
 */
export interface DirectoryApprovalCallbacks {
    /**
     * Check if a path is within any session-approved directory.
     * Used to determine if directory approval prompt is needed.
     * @param filePath The file path to check (absolute or relative)
     * @returns true if path is in a session-approved directory
     */
    isSessionApproved: (filePath: string) => boolean;

    /**
     * Add a directory to the approved list for this session.
     * Called after user approves directory access.
     * @param directory Absolute path to the directory to approve
     * @param type 'session' (remembered) or 'once' (single use)
     */
    addApproved: (directory: string, type: 'session' | 'once') => void;
}

/**
 * Options for creating file tools with directory approval support
 */
export interface FileToolOptions {
    /** FileSystemService instance for file operations */
    fileSystemService: FileSystemService;

    /**
     * Optional callbacks for directory approval.
     * If provided, file tools can request approval for accessing paths
     * outside the configured working directory.
     */
    directoryApproval?: DirectoryApprovalCallbacks | undefined;
}
