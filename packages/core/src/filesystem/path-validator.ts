/**
 * Path Validator
 *
 * Security-focused path validation for file system operations
 */

import * as path from 'node:path';
import { realpathSync } from 'node:fs';
import { FileSystemConfig, PathValidation } from './types.js';
import type { IDextoLogger } from '../logger/v2/types.js';

/**
 * PathValidator - Validates file paths for security and policy compliance
 *
 * Security checks:
 * 1. Path traversal detection (../, symbolic links)
 * 2. Allowed paths enforcement (whitelist)
 * 3. Blocked paths detection (blacklist)
 * 4. File extension restrictions
 * 5. Absolute path normalization
 * TODO: Add tests
 */
export class PathValidator {
    private config: FileSystemConfig;
    private normalizedAllowedPaths: string[];
    private normalizedBlockedPaths: string[];
    private normalizedBlockedExtensions: string[];
    private logger: IDextoLogger | undefined;

    constructor(config: FileSystemConfig, logger?: IDextoLogger) {
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

        this.logger?.debug(
            `PathValidator initialized with ${this.normalizedAllowedPaths.length} allowed paths`
        );
    }

    /**
     * Validate a file path for security and policy compliance
     */
    validatePath(filePath: string): PathValidation {
        // 1. Check for empty path
        if (!filePath || filePath.trim() === '') {
            return {
                isValid: false,
                error: 'Path cannot be empty',
            };
        }

        // 2. Normalize the path to absolute
        const workingDir = this.config.workingDirectory || process.cwd();
        let normalizedPath: string;

        try {
            // Handle both absolute and relative paths
            normalizedPath = path.isAbsolute(filePath)
                ? path.resolve(filePath)
                : path.resolve(workingDir, filePath);

            // Canonicalize to handle symlinks and resolve real paths
            try {
                // native variant preserves casing on Windows
                normalizedPath = realpathSync.native(normalizedPath);
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

        // 4. Check if path is within allowed paths
        if (!this.isPathAllowed(normalizedPath)) {
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
     */
    private isPathAllowed(normalizedPath: string): boolean {
        // Empty allowedPaths means all paths are allowed
        if (this.normalizedAllowedPaths.length === 0) {
            return true;
        }

        // Check if path is within any allowed path
        return this.normalizedAllowedPaths.some((allowedPath) => {
            const relative = path.relative(allowedPath, normalizedPath);
            // Path is allowed if it doesn't escape the allowed directory
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        });
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
     */
    isPathAllowedQuick(normalizedPath: string): boolean {
        return this.isPathAllowed(normalizedPath) && !this.isPathBlocked(normalizedPath);
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
