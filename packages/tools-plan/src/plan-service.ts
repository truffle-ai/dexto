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
import type { IDextoLogger } from '@dexto/core';
import { PlanMetaSchema } from './types.js';
import type {
    Plan,
    PlanMeta,
    PlanServiceOptions,
    PlanUpdateResult,
    CheckpointStatus,
} from './types.js';
import { PlanError } from './errors.js';

const PLAN_FILENAME = 'plan.md';
const META_FILENAME = 'plan-meta.json';

/**
 * Service for managing implementation plans.
 */
export class PlanService {
    private basePath: string;
    private logger: IDextoLogger | undefined;

    constructor(options: PlanServiceOptions, logger?: IDextoLogger) {
        this.basePath = options.basePath;
        this.logger = logger;
    }

    /**
     * Gets the directory path for a session's plan
     */
    private getPlanDir(sessionId: string): string {
        return path.join(this.basePath, sessionId);
    }

    /**
     * Gets the path to the plan content file
     */
    private getPlanPath(sessionId: string): string {
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
    async create(
        sessionId: string,
        content: string,
        options?: { title?: string; checkpoints?: Array<{ id: string; description: string }> }
    ): Promise<Plan> {
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
            checkpoints: options?.checkpoints?.map((cp) => ({
                id: cp.id,
                description: cp.description,
                status: 'pending' as const,
            })),
        };

        try {
            // Ensure directory exists
            await fs.mkdir(planDir, { recursive: true });

            // Write plan content and metadata
            await Promise.all([
                fs.writeFile(this.getPlanPath(sessionId), content, 'utf-8'),
                fs.writeFile(this.getMetaPath(sessionId), JSON.stringify(meta, null, 2), 'utf-8'),
            ]);

            this.logger?.debug(`Created plan for session ${sessionId}`);

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
                this.logger?.warn(`Invalid plan metadata for session ${sessionId}, using defaults`);
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
            this.logger?.error(`Failed to read plan for session ${sessionId}: ${error}`);
            return null;
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

            this.logger?.debug(`Updated plan for session ${sessionId}`);

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
     * Updates the plan metadata (status, checkpoints, etc.)
     *
     * @throws PlanError.planNotFound if plan doesn't exist
     * @throws PlanError.storageError on filesystem errors
     */
    async updateMeta(
        sessionId: string,
        updates: Partial<Pick<PlanMeta, 'status' | 'title' | 'checkpoints'>>
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

            this.logger?.debug(`Updated plan metadata for session ${sessionId}`);

            return updatedMeta;
        } catch (error) {
            throw PlanError.storageError('update metadata', sessionId, error as Error);
        }
    }

    /**
     * Updates a specific checkpoint's status
     *
     * @throws PlanError.planNotFound if plan doesn't exist
     * @throws PlanError.checkpointNotFound if checkpoint doesn't exist
     * @throws PlanError.storageError on filesystem errors
     */
    async updateCheckpoint(
        sessionId: string,
        checkpointId: string,
        status: CheckpointStatus
    ): Promise<PlanMeta> {
        const existing = await this.read(sessionId);
        if (!existing) {
            throw PlanError.planNotFound(sessionId);
        }

        const checkpoints = existing.meta.checkpoints;
        if (!checkpoints) {
            throw PlanError.checkpointNotFound(checkpointId, sessionId);
        }

        const checkpointIndex = checkpoints.findIndex((cp) => cp.id === checkpointId);
        if (checkpointIndex === -1) {
            throw PlanError.checkpointNotFound(checkpointId, sessionId);
        }

        // Update the checkpoint - existingCheckpoint is guaranteed to exist since we found its index
        const existingCheckpoint = checkpoints[checkpointIndex]!;
        const updatedCheckpoints: typeof checkpoints = checkpoints.map((cp, index) =>
            index === checkpointIndex
                ? { id: existingCheckpoint.id, description: existingCheckpoint.description, status }
                : cp
        );

        return this.updateMeta(sessionId, { checkpoints: updatedCheckpoints });
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
            this.logger?.debug(`Deleted plan for session ${sessionId}`);
        } catch (error) {
            throw PlanError.storageError('delete', sessionId, error as Error);
        }
    }
}
