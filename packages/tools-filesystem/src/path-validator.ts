/**
 * Path Validator
 *
 * Security-focused path validation for file system operations
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { FileSystemConfig, PathValidation } from './types.js';
import type { Logger } from '@dexto/core';

/**
 * Callback type for checking if a path is in an approved directory.
 * Used to consult ApprovalManager without creating a direct dependency.
 */
export type DirectoryApprovalChecker = (filePath: string) => boolean;

/**
 * PathValidator - Validates file paths for security and policy compliance
 *
 * Security checks:
 * 1. Path traversal detection (../, symbolic links)
 * 2. Allowed paths enforcement (whitelist + approved directories)
 * 3. Blocked paths detection (blacklist)
 * 4. File extension restrictions
 * 5. Absolute path normalization
 *
 * PathValidator can optionally consult an external approval checker (e.g., ApprovalManager)
 * to determine if paths outside the config's allowed paths are accessible.
 */
export class PathValidator {
    private config: FileSystemConfig;
    private normalizedAllowedPaths: string[];
    private normalizedBlockedPaths: string[];
    private normalizedBlockedExtensions: string[];
    private logger: Logger;
    private directoryApprovalChecker: DirectoryApprovalChecker | undefined;

    constructor(config: FileSystemConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;

        // Normalize allowed paths to absolute paths
        const workingDir = config.workingDirectory || process.cwd();
        this.normalizedAllowedPaths = config.allowedPaths.map((p) => path.resolve(workingDir, p));

        // Normalize blocked paths
        this.normalizedBlockedPaths = config.blockedPaths.map((p) => path.normalize(p));

        // Normalize blocked extensions: ensure leading dot and lowercase
        this.normalizedBlockedExtensions = (config.blockedExtensions || []).map((ext) => {
            const e = ext.startsWith('.') ? ext : `.${ext}`;
            return e.toLowerCase();
        });

        this.logger.debug(
            `PathValidator initialized with ${this.normalizedAllowedPaths.length} allowed paths`
        );
    }

    /**
     * Set a callback to check if a path is in an approved directory.
     * This allows PathValidator to consult ApprovalManager without a direct dependency.
     *
     * @param checker Function that returns true if path is in an approved directory
     */
    setDirectoryApprovalChecker(checker: DirectoryApprovalChecker): void {
        this.directoryApprovalChecker = checker;
        this.logger.debug('Directory approval checker configured');
    }

    /**
     * Validate a file path for security and policy compliance
     */
    async validatePath(filePath: string): Promise<PathValidation> {
        return this.validatePathInternal(filePath, { skipAllowedCheck: false });
    }

    /**
     * Validate a file path for preview purposes.
     *
     * This is identical to {@link validatePath} except it does NOT enforce config-allowed roots.
     * It still enforces:
     * - traversal protection
     * - blocked paths (absolute blocked paths only; relative blocked paths are resolved against
     *   config-allowed roots and may not match paths outside those roots)
     * - blocked extensions
     *
     * Used for generating UI-only previews (e.g., diffs) before the user approves directory access.
     */
    async validatePathForPreview(filePath: string): Promise<PathValidation> {
        return this.validatePathInternal(filePath, { skipAllowedCheck: true });
    }

    private async validatePathInternal(
        filePath: string,
        options: { skipAllowedCheck: boolean }
    ): Promise<PathValidation> {
        // 1. Check for empty path
        if (!filePath || filePath.trim() === '') {
            return {
                isValid: false,
                error: 'Path cannot be empty',
            };
        }

        // 2. Normalize the path to absolute
        const workingDir = this.config.workingDirectory || process.cwd();
        let resolvedPath: string;
        let normalizedPath: string;

        try {
            // Handle both absolute and relative paths
            resolvedPath = path.isAbsolute(filePath)
                ? path.resolve(filePath)
                : path.resolve(workingDir, filePath);
            normalizedPath = resolvedPath;

            // Canonicalize to handle symlinks and resolve real paths (async, non-blocking)
            try {
                normalizedPath = await fs.realpath(normalizedPath);
            } catch {
                // If the path doesn't exist yet (e.g., writes), fallback to the resolved path
                // Policy checks continue to use normalizedPath
            }
        } catch (error) {
            return {
                isValid: false,
                error: `Failed to normalize path: ${error instanceof Error ? error.message : String(error)}`,
            };
        }

        // 3. Check for path traversal attempts
        if (this.hasPathTraversal(filePath, normalizedPath)) {
            return {
                isValid: false,
                error: 'Path traversal detected',
            };
        }

        if (
            options.skipAllowedCheck &&
            this.isInConfigAllowedPaths(resolvedPath) &&
            !this.isInConfigAllowedPaths(normalizedPath)
        ) {
            return {
                isValid: false,
                error: 'Symlink target escapes allowed paths',
            };
        }

        // 4. Check if path is within allowed paths
        if (!options.skipAllowedCheck && !this.isPathAllowed(normalizedPath)) {
            return {
                isValid: false,
                error: `Path is not within allowed paths. Allowed: ${this.normalizedAllowedPaths.join(', ')}`,
            };
        }

        // 5. Check if path is blocked
        const blockedReason = this.isPathBlocked(normalizedPath);
        if (blockedReason) {
            return {
                isValid: false,
                error: `Path is blocked: ${blockedReason}`,
            };
        }

        // 6. Check file extension if applicable
        const ext = path.extname(normalizedPath).toLowerCase();
        if (ext && this.normalizedBlockedExtensions.includes(ext)) {
            return {
                isValid: false,
                error: `File extension ${ext} is not allowed`,
            };
        }

        return {
            isValid: true,
            normalizedPath,
        };
    }

    /**
     * Check if path contains traversal attempts
     */
    private hasPathTraversal(originalPath: string, normalizedPath: string): boolean {
        // Check for ../ patterns in original path
        if (originalPath.includes('../') || originalPath.includes('..\\')) {
            // Verify the normalized path still escapes allowed boundaries
            const workingDir = this.config.workingDirectory || process.cwd();
            const relative = path.relative(workingDir, normalizedPath);
            if (relative.startsWith('..')) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if path is within allowed paths (whitelist check)
     * Also consults the directory approval checker if configured.
     * Uses the sync version since the path is already normalized at this point.
     */
    private isPathAllowed(normalizedPath: string): boolean {
        return this.isPathAllowedSync(normalizedPath);
    }

    /**
     * Check if path matches blocked patterns (blacklist check)
     */
    private isPathBlocked(normalizedPath: string): string | null {
        const roots =
            this.normalizedAllowedPaths.length > 0
                ? this.normalizedAllowedPaths
                : [this.config.workingDirectory || process.cwd()];

        for (const blocked of this.normalizedBlockedPaths) {
            for (const root of roots) {
                // Resolve blocked relative to each allowed root unless already absolute
                const blockedFull = path.isAbsolute(blocked)
                    ? path.normalize(blocked)
                    : path.resolve(root, blocked);
                // Segment-aware prefix check
                if (
                    normalizedPath === blockedFull ||
                    normalizedPath.startsWith(blockedFull + path.sep)
                ) {
                    return `Within blocked directory: ${blocked}`;
                }
            }
        }

        return null;
    }

    /**
     * Quick check if a path is allowed (for internal use)
     * Note: This assumes the path is already normalized/canonicalized
     */
    isPathAllowedQuick(normalizedPath: string): boolean {
        return this.isPathAllowedSync(normalizedPath) && !this.isPathBlocked(normalizedPath);
    }

    /**
     * Synchronous path allowed check (for already-normalized paths)
     * This is used internally when we already have a canonicalized path
     */
    private isPathAllowedSync(normalizedPath: string): boolean {
        // Empty allowedPaths means all paths are allowed
        if (this.normalizedAllowedPaths.length === 0) {
            return true;
        }

        // Check if path is within any config-allowed path
        const isInConfigPaths = this.normalizedAllowedPaths.some((allowedPath) => {
            const relative = path.relative(allowedPath, normalizedPath);
            // Path is allowed if it doesn't escape the allowed directory
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        });

        if (isInConfigPaths) {
            return true;
        }

        // Fallback: check ApprovalManager via callback (includes working dir + approved dirs)
        if (this.directoryApprovalChecker) {
            return this.directoryApprovalChecker(normalizedPath);
        }

        return false;
    }

    /**
     * Check if a file path is within the configured allowed paths (from config only).
     * This method does NOT consult ApprovalManager - it only checks the static config paths.
     *
     * This is used by file tools to determine if a path needs directory approval.
     * Paths within config-allowed directories don't need directory approval prompts.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within config-allowed paths, false otherwise
     */
    async isPathWithinAllowed(filePath: string): Promise<boolean> {
        if (!filePath || filePath.trim() === '') {
            return false;
        }

        // Normalize the path to absolute
        const workingDir = this.config.workingDirectory || process.cwd();
        let normalizedPath: string;

        try {
            normalizedPath = path.isAbsolute(filePath)
                ? path.resolve(filePath)
                : path.resolve(workingDir, filePath);

            // Try to resolve symlinks for existing files (async, non-blocking)
            try {
                normalizedPath = await fs.realpath(normalizedPath);
            } catch {
                // Path doesn't exist yet, use resolved path
            }
        } catch {
            // Failed to normalize, treat as not within allowed
            return false;
        }

        // Only check config paths - do NOT consult approval checker here
        // This method is used for prompting decisions, not execution decisions
        return this.isInConfigAllowedPaths(normalizedPath);
    }

    /**
     * Check if path is within config-allowed paths only (no approval checker).
     * Used for prompting decisions.
     */
    private isInConfigAllowedPaths(normalizedPath: string): boolean {
        // Empty allowedPaths means all paths are allowed
        if (this.normalizedAllowedPaths.length === 0) {
            return true;
        }

        return this.normalizedAllowedPaths.some((allowedPath) => {
            const relative = path.relative(allowedPath, normalizedPath);
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        });
    }

    /**
     * Get normalized allowed paths
     */
    getAllowedPaths(): string[] {
        return [...this.normalizedAllowedPaths];
    }

    /**
     * Get blocked paths
     */
    getBlockedPaths(): string[] {
        return [...this.normalizedBlockedPaths];
    }
}
