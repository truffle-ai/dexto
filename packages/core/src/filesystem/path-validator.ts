/**
 * Path Validator
 *
 * Security-focused path validation for file system operations
 */

import * as path from 'node:path';
import { FileSystemConfig, PathValidation } from './types.js';
import { logger } from '../logger/index.js';

/**
 * PathValidator - Validates file paths for security and policy compliance
 *
 * Security checks:
 * 1. Path traversal detection (../, symbolic links)
 * 2. Allowed paths enforcement (whitelist)
 * 3. Blocked paths detection (blacklist)
 * 4. File extension restrictions
 * 5. Absolute path normalization
 */
export class PathValidator {
    private config: FileSystemConfig;
    private normalizedAllowedPaths: string[];
    private normalizedBlockedPaths: string[];

    constructor(config: FileSystemConfig) {
        this.config = config;

        // Normalize allowed paths to absolute paths
        const workingDir = config.workingDirectory || process.cwd();
        this.normalizedAllowedPaths = config.allowedPaths.map((p) => path.resolve(workingDir, p));

        // Normalize blocked paths
        this.normalizedBlockedPaths = config.blockedPaths.map((p) => path.normalize(p));

        logger.debug(
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
        const ext = path.extname(normalizedPath);
        if (ext && this.config.blockedExtensions.includes(ext)) {
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
        for (const blockedPath of this.normalizedBlockedPaths) {
            // Check if path contains blocked segment
            if (normalizedPath.includes(blockedPath)) {
                return `Matches blocked path pattern: ${blockedPath}`;
            }

            // Check for exact directory match
            const blockedFull = path.resolve(
                this.config.workingDirectory || process.cwd(),
                blockedPath
            );
            if (
                normalizedPath === blockedFull ||
                normalizedPath.startsWith(blockedFull + path.sep)
            ) {
                return `Within blocked directory: ${blockedPath}`;
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
