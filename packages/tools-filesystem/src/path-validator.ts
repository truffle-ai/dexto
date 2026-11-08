/**
 * Path Validator
 *
 * Security-focused path validation for file system operations
 */

import * as path from 'node:path';
import { FileSystemConfig, PathValidation } from './types.js';
import type { Logger } from '@dexto/core/logger';
import { expandHomeShorthand, resolveUserPath } from './path-utils.js';
import { canonicalizePath } from './safe-fs.js';

/**
 * Callback type for checking if a path is in an approved directory.
 * Used to consult ApprovalManager without creating a direct dependency.
 */
export type DirectoryApprovalOperation = 'read' | 'write' | 'edit';
export type DirectoryApprovalChecker = (
    filePath: string,
    operation: DirectoryApprovalOperation
) => boolean;

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
    /** Canonical (symlink-resolved) forms of allowed roots, resolved once on first use. */
    private canonicalAllowedPaths: string[] = [];
    /** Blocked paths as absolute paths, in both lexical and canonical form. */
    private resolvedBlockedPaths: Array<{ blocked: string; fullPath: string }> = [];
    private canonicalPathsReady: Promise<void> | undefined;
    private normalizedBlockedPaths: string[];
    private normalizedBlockedExtensions: string[];
    private logger: Logger;
    private directoryApprovalChecker: DirectoryApprovalChecker | undefined;

    constructor(config: FileSystemConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;

        // Normalize allowed paths to absolute paths
        const workingDir = resolveUserPath(process.cwd(), config.workingDirectory || process.cwd());
        this.normalizedAllowedPaths = config.allowedPaths.map((p) =>
            resolveUserPath(workingDir, p)
        );

        // Normalize blocked paths
        this.normalizedBlockedPaths = config.blockedPaths.map((p) =>
            path.normalize(expandHomeShorthand(p))
        );

        this.resolvedBlockedPaths = this.resolveBlockedPaths(this.normalizedAllowedPaths);

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
    async validatePath(
        filePath: string,
        operation: DirectoryApprovalOperation,
        options: { followFinalSymlink?: boolean } = {}
    ): Promise<PathValidation> {
        return this.validatePathInternal(filePath, {
            skipAllowedCheck: false,
            operation,
            followFinalSymlink: options.followFinalSymlink ?? true,
        });
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
        return this.validatePathInternal(filePath, {
            skipAllowedCheck: true,
            operation: 'read',
            followFinalSymlink: true,
        });
    }

    private async validatePathInternal(
        filePath: string,
        options: {
            skipAllowedCheck: boolean;
            operation: DirectoryApprovalOperation;
            followFinalSymlink: boolean;
        }
    ): Promise<PathValidation> {
        // 1. Check for empty path
        if (!filePath || filePath.trim() === '') {
            return {
                isValid: false,
                error: 'Path cannot be empty',
            };
        }

        // 2. Normalize the path to absolute
        const workingDir = resolveUserPath(
            process.cwd(),
            this.config.workingDirectory || process.cwd()
        );
        let resolvedPath: string;
        let normalizedPath: string;

        try {
            // Handle both absolute and relative paths
            resolvedPath = resolveUserPath(workingDir, filePath);

            // Canonicalize so policy checks see where the operation will really land. For paths
            // that do not exist yet this resolves the nearest existing ancestor and any dangling
            // symlink, so a link inside an allowed root cannot redirect a new file outside it.
            normalizedPath = await canonicalizePath(resolvedPath, {
                followFinalSymlink: options.followFinalSymlink,
            });
            await this.ensureCanonicalPaths();
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
        if (!options.skipAllowedCheck && !this.isPathAllowed(normalizedPath, options.operation)) {
            return {
                isValid: false,
                error: `Path is not within allowed paths. Allowed: ${this.normalizedAllowedPaths.join(', ')}`,
            };
        }

        // 5. Check if path is blocked (either the canonical target or the path as given)
        const blockedReason =
            this.isPathBlocked(normalizedPath) ?? this.isPathBlocked(resolvedPath);
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
            const workingDir = resolveUserPath(
                process.cwd(),
                this.config.workingDirectory || process.cwd()
            );
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
    private isPathAllowed(normalizedPath: string, operation: DirectoryApprovalOperation): boolean {
        return this.isPathAllowedSync(normalizedPath, operation);
    }

    /**
     * Check if path matches blocked patterns (blacklist check)
     */
    private isPathBlocked(normalizedPath: string): string | null {
        for (const { blocked, fullPath } of this.resolvedBlockedPaths) {
            // Segment-aware prefix check
            if (normalizedPath === fullPath || normalizedPath.startsWith(fullPath + path.sep)) {
                return `Within blocked directory: ${blocked}`;
            }
        }

        return null;
    }

    /**
     * Resolve each blocked path to an absolute path: absolute entries as-is, relative entries
     * against each of the given roots (or the working directory when no roots are configured).
     */
    private resolveBlockedPaths(roots: string[]): Array<{ blocked: string; fullPath: string }> {
        const effectiveRoots =
            roots.length > 0
                ? roots
                : [resolveUserPath(process.cwd(), this.config.workingDirectory || process.cwd())];
        const resolved: Array<{ blocked: string; fullPath: string }> = [];
        for (const blocked of this.normalizedBlockedPaths) {
            if (path.isAbsolute(blocked)) {
                resolved.push({ blocked, fullPath: path.normalize(blocked) });
                continue;
            }
            for (const root of effectiveRoots) {
                resolved.push({ blocked, fullPath: path.resolve(root, blocked) });
            }
        }
        return resolved;
    }

    /**
     * Quick check if a path is allowed (for internal use)
     * Note: This assumes the path is already normalized/canonicalized
     */
    isPathAllowedQuick(normalizedPath: string, operation: DirectoryApprovalOperation): boolean {
        return (
            this.isPathAllowedSync(normalizedPath, operation) && !this.isPathBlocked(normalizedPath)
        );
    }

    /**
     * Synchronous path allowed check (for already-normalized paths)
     * This is used internally when we already have a canonicalized path
     */
    private isPathAllowedSync(
        normalizedPath: string,
        operation: DirectoryApprovalOperation
    ): boolean {
        // Empty allowedPaths means all paths are allowed
        if (this.normalizedAllowedPaths.length === 0) {
            return true;
        }

        if (this.isInConfigAllowedPaths(normalizedPath)) {
            return true;
        }

        // Fallback: check ApprovalManager via callback (includes working dir + approved dirs)
        if (this.directoryApprovalChecker) {
            return this.directoryApprovalChecker(normalizedPath, operation);
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
        const workingDir = resolveUserPath(
            process.cwd(),
            this.config.workingDirectory || process.cwd()
        );
        let normalizedPath: string;

        try {
            normalizedPath = await canonicalizePath(resolveUserPath(workingDir, filePath));
            await this.ensureCanonicalPaths();
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

        return [...this.normalizedAllowedPaths, ...this.canonicalAllowedPaths].some((allowedPath) =>
            isWithinRoot(allowedPath, normalizedPath)
        );
    }

    /**
     * Allowed roots and blocked paths are configured lexically, but validated paths are
     * canonical. Resolve their canonical forms once, on first use, so a root reached through a
     * symlink (for example macOS `/tmp` -> `/private/tmp`) still matches its own files and a
     * blocked path reached through an alias is still blocked. Resolving only once means a
     * symlink planted at a root location later cannot widen what is allowed.
     */
    private ensureCanonicalPaths(): Promise<void> {
        this.canonicalPathsReady ??= this.resolveCanonicalPaths();
        return this.canonicalPathsReady;
    }

    private async resolveCanonicalPaths(): Promise<void> {
        const canonicalize = (p: string) => canonicalizePath(p).catch(() => p);
        const canonicalRoots = await Promise.all(this.normalizedAllowedPaths.map(canonicalize));
        this.canonicalAllowedPaths = canonicalRoots.filter(
            (canonicalPath, index) => canonicalPath !== this.normalizedAllowedPaths[index]
        );

        const lexicalBlocked = this.resolveBlockedPaths([
            ...this.normalizedAllowedPaths,
            ...this.canonicalAllowedPaths,
        ]);
        const canonicalBlocked = await Promise.all(
            lexicalBlocked.map(async ({ blocked, fullPath }) => ({
                blocked,
                fullPath: await canonicalize(fullPath),
            }))
        );
        const seen = new Set<string>();
        this.resolvedBlockedPaths = [...lexicalBlocked, ...canonicalBlocked].filter(
            ({ fullPath }) => {
                if (seen.has(fullPath)) return false;
                seen.add(fullPath);
                return true;
            }
        );
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

function isWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    if (relative === '') {
        return true;
    }
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
