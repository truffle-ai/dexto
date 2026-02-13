/**
 * Plan Service
 *
 * Handles storage and retrieval of implementation plans.
 * Plans are stored in .dexto/plans/{sessionId}/ with:
 * - plan.md: The plan content
 * - plan-meta.json: Metadata (status, checkpoints, timestamps)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from '@dexto/core';
import { PlanMetaSchema } from './types.js';
import type { Plan, PlanMeta, PlanServiceOptions, PlanUpdateResult } from './types.js';
import { PlanError } from './errors.js';

const PLAN_FILENAME = 'plan.md';
const META_FILENAME = 'plan-meta.json';

/**
 * Service for managing implementation plans.
 */
export class PlanService {
    private basePath: string;
    private logger: Logger;

    constructor(options: PlanServiceOptions, logger: Logger) {
        this.basePath = options.basePath;
        this.logger = logger;
    }

    /**
     * Resolves and validates a session directory path.
     * Prevents path traversal attacks by ensuring the resolved path stays within basePath.
     */
    private resolveSessionDir(sessionId: string): string {
        const base = path.resolve(this.basePath);
        const resolved = path.resolve(base, sessionId);
        const rel = path.relative(base, resolved);
        // Check for path traversal (upward traversal)
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw PlanError.invalidSessionId(sessionId);
        }
        return resolved;
    }

    /**
     * Gets the directory path for a session's plan
     */
    private getPlanDir(sessionId: string): string {
        return this.resolveSessionDir(sessionId);
    }

    /**
     * Gets the path to the plan content file.
     * Public accessor for tools that need to display the path.
     */
    public getPlanPath(sessionId: string): string {
        return path.join(this.getPlanDir(sessionId), PLAN_FILENAME);
    }

    /**
     * Gets the path to the plan metadata file
     */
    private getMetaPath(sessionId: string): string {
        return path.join(this.getPlanDir(sessionId), META_FILENAME);
    }

    /**
     * Checks if a plan exists for the given session
     */
    async exists(sessionId: string): Promise<boolean> {
        const planPath = this.getPlanPath(sessionId);
        return existsSync(planPath);
    }

    /**
     * Creates a new plan for the session
     *
     * @throws PlanError.planAlreadyExists if plan already exists
     * @throws PlanError.storageError on filesystem errors
     */
    async create(sessionId: string, content: string, options?: { title?: string }): Promise<Plan> {
        // Check if plan already exists
        if (await this.exists(sessionId)) {
            throw PlanError.planAlreadyExists(sessionId);
        }

        const planDir = this.getPlanDir(sessionId);
        const now = Date.now();

        // Create metadata
        const meta: PlanMeta = {
            sessionId,
            status: 'draft',
            title: options?.title,
            createdAt: now,
            updatedAt: now,
        };

        try {
            // Ensure directory exists
            await fs.mkdir(planDir, { recursive: true });

            // Write plan content and metadata
            await Promise.all([
                fs.writeFile(this.getPlanPath(sessionId), content, 'utf-8'),
                fs.writeFile(this.getMetaPath(sessionId), JSON.stringify(meta, null, 2), 'utf-8'),
            ]);

            this.logger.debug(`Created plan for session ${sessionId}`);

            return { content, meta };
        } catch (error) {
            throw PlanError.storageError('create', sessionId, error as Error);
        }
    }

    /**
     * Reads the plan for the given session
     *
     * @returns The plan or null if not found
     */
    async read(sessionId: string): Promise<Plan | null> {
        if (!(await this.exists(sessionId))) {
            return null;
        }

        try {
            const [content, metaContent] = await Promise.all([
                fs.readFile(this.getPlanPath(sessionId), 'utf-8'),
                fs.readFile(this.getMetaPath(sessionId), 'utf-8'),
            ]);

            const metaParsed = JSON.parse(metaContent);
            const metaResult = PlanMetaSchema.safeParse(metaParsed);

            if (!metaResult.success) {
                this.logger.warn(`Invalid plan metadata for session ${sessionId}, using defaults`);
                // Return with minimal metadata if parsing fails
                return {
                    content,
                    meta: {
                        sessionId,
                        status: 'draft',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    },
                };
            }

            return { content, meta: metaResult.data };
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            // ENOENT means file doesn't exist - return null (expected case)
            if (err.code === 'ENOENT') {
                return null;
            }
            // JSON parse errors (SyntaxError) mean corrupted data - treat as not found
            // but log for debugging
            if (error instanceof SyntaxError) {
                this.logger.error(`Failed to read plan for session ${sessionId}: ${error.message}`);
                return null;
            }
            // For real I/O errors (permission denied, disk issues), throw to surface the issue
            this.logger.error(
                `Failed to read plan for session ${sessionId}: ${err.message ?? String(err)}`
            );
            throw PlanError.storageError('read', sessionId, err);
        }
    }

    /**
     * Updates the plan content for the given session
     *
     * @throws PlanError.planNotFound if plan doesn't exist
     * @throws PlanError.storageError on filesystem errors
     */
    async update(sessionId: string, content: string): Promise<PlanUpdateResult> {
        const existing = await this.read(sessionId);
        if (!existing) {
            throw PlanError.planNotFound(sessionId);
        }

        const oldContent = existing.content;
        const now = Date.now();

        // Update metadata
        const updatedMeta: PlanMeta = {
            ...existing.meta,
            updatedAt: now,
        };

        try {
            await Promise.all([
                fs.writeFile(this.getPlanPath(sessionId), content, 'utf-8'),
                fs.writeFile(
                    this.getMetaPath(sessionId),
                    JSON.stringify(updatedMeta, null, 2),
                    'utf-8'
                ),
            ]);

            this.logger.debug(`Updated plan for session ${sessionId}`);

            return {
                oldContent,
                newContent: content,
                meta: updatedMeta,
            };
        } catch (error) {
            throw PlanError.storageError('update', sessionId, error as Error);
        }
    }

    /**
     * Updates the plan metadata (status, title)
     *
     * @throws PlanError.planNotFound if plan doesn't exist
     * @throws PlanError.storageError on filesystem errors
     */
    async updateMeta(
        sessionId: string,
        updates: Partial<Pick<PlanMeta, 'status' | 'title'>>
    ): Promise<PlanMeta> {
        const existing = await this.read(sessionId);
        if (!existing) {
            throw PlanError.planNotFound(sessionId);
        }

        const updatedMeta: PlanMeta = {
            ...existing.meta,
            ...updates,
            updatedAt: Date.now(),
        };

        try {
            await fs.writeFile(
                this.getMetaPath(sessionId),
                JSON.stringify(updatedMeta, null, 2),
                'utf-8'
            );

            this.logger.debug(`Updated plan metadata for session ${sessionId}`);

            return updatedMeta;
        } catch (error) {
            throw PlanError.storageError('update metadata', sessionId, error as Error);
        }
    }

    /**
     * Deletes the plan for the given session
     *
     * @throws PlanError.planNotFound if plan doesn't exist
     * @throws PlanError.storageError on filesystem errors
     */
    async delete(sessionId: string): Promise<void> {
        if (!(await this.exists(sessionId))) {
            throw PlanError.planNotFound(sessionId);
        }

        try {
            await fs.rm(this.getPlanDir(sessionId), { recursive: true, force: true });
            this.logger.debug(`Deleted plan for session ${sessionId}`);
        } catch (error) {
            throw PlanError.storageError('delete', sessionId, error as Error);
        }
    }
}
