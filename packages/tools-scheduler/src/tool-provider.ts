/**
 * Scheduler Tools Factory
 *
 * Provides cron-based scheduling capabilities for proactive agent behavior.
 * When a scheduled task triggers, it invokes the agent with the task instruction.
 */

import type { ToolFactory } from '@dexto/agent-config';
import type { Tool, ToolExecutionContext, Logger } from '@dexto/core';
import { ToolError } from '@dexto/core';
import { SchedulerToolsConfigSchema, type SchedulerToolsConfig } from './schemas.js';
import { SchedulerManager } from './manager.js';
import { SchedulerError } from './errors.js';
import type { SchedulerManagerGetter } from './tool-types.js';

// Tool factory imports
import { createCreateScheduleTool } from './tools/create-schedule.js';
import { createListSchedulesTool } from './tools/list-schedules.js';
import { createGetScheduleTool } from './tools/get-schedule.js';
import { createUpdateScheduleTool } from './tools/update-schedule.js';
import { createDeleteScheduleTool } from './tools/delete-schedule.js';
import { createTriggerScheduleTool } from './tools/trigger-schedule.js';
import { createGetScheduleHistoryTool } from './tools/get-history.js';

/**
 * Registry to store scheduler manager instances by agent ID.
 */
const schedulerManagerRegistry = new Map<string, SchedulerManager>();
const schedulerConfigRegistry = new Map<string, SchedulerToolsConfig>();
const schedulerManagerInitPromises = new Map<string, Promise<SchedulerManager | null>>();
let defaultSchedulerConfig: SchedulerToolsConfig | undefined;

/**
 * Get a scheduler manager instance by agent ID.
 * Returns undefined if no scheduler is registered for the agent.
 */
export function getSchedulerManager(agentId: string): SchedulerManager | undefined {
    return schedulerManagerRegistry.get(agentId);
}

/**
 * Ensure a scheduler manager is available for the given agent.
 * Returns null if scheduler tools are not enabled in this process.
 */
export async function ensureSchedulerManagerForAgent(
    agent: ToolExecutionContext['agent'],
    config?: SchedulerToolsConfig,
    loggerOverride?: Logger
): Promise<SchedulerManager | null> {
    if (!agent) {
        return null;
    }

    const agentId = agent.config?.agentId ?? 'default';
    const existing = schedulerManagerRegistry.get(agentId);
    if (existing) {
        return existing;
    }

    const inflight = schedulerManagerInitPromises.get(agentId);
    if (inflight) {
        return inflight;
    }

    const agentConfig = schedulerConfigRegistry.get(agentId);
    const resolvedConfig = config ?? agentConfig ?? defaultSchedulerConfig;
    if (!resolvedConfig) {
        return null;
    }

    if (!config && !agentConfig && defaultSchedulerConfig) {
        const logger = loggerOverride ?? agent.logger;
        logger.debug('Using default scheduler config', { agentId });
    }

    const initPromise = (async () => {
        const storageManager = agent.services?.storageManager;
        if (!storageManager) {
            throw SchedulerError.missingStorage();
        }

        const logger = loggerOverride ?? agent.logger;

        const manager = new SchedulerManager(storageManager, resolvedConfig, logger);

        const waitForAgentStart = async (): Promise<boolean> => {
            if (!agent || typeof agent.isStarted !== 'function') {
                return true;
            }

            if (agent.isStarted()) {
                return true;
            }

            const timeoutMs = 15_000;
            const startAt = Date.now();

            while (!agent.isStarted()) {
                if (typeof agent.isStopped === 'function' && agent.isStopped()) {
                    return false;
                }
                if (Date.now() - startAt > timeoutMs) {
                    logger.warn('Scheduler start delayed: agent did not finish starting in time.');
                    return false;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            return true;
        };

        const withWorkspaceContext = async <T>(
            workspacePath: string | undefined,
            handler: () => Promise<T>
        ): Promise<T> => {
            if (!agent || typeof agent.getWorkspace !== 'function') {
                return await handler();
            }

            const previous = await agent.getWorkspace();
            const needsChange = workspacePath
                ? previous?.path !== workspacePath
                : Boolean(previous);

            if (needsChange) {
                if (workspacePath) {
                    await agent.setWorkspace({ path: workspacePath });
                } else {
                    await agent.clearWorkspace();
                }
            }

            try {
                return await handler();
            } finally {
                if (needsChange) {
                    try {
                        if (!previous) {
                            await agent.clearWorkspace();
                        } else {
                            await agent.setWorkspace({
                                path: previous.path,
                                ...(previous.name ? { name: previous.name } : {}),
                            });
                        }
                    } catch (restoreError) {
                        logger.error('Failed to restore workspace after scheduled execution', {
                            error:
                                restoreError instanceof Error
                                    ? restoreError.message
                                    : String(restoreError),
                        });
                    }
                }
            }
        };

        manager.setExecutor(async ({ prompt, sessionId, schedule }) => {
            const ready = await waitForAgentStart();
            if (!ready) {
                throw SchedulerError.executionFailed(
                    schedule.id,
                    'Agent is not started. Scheduled execution skipped.'
                );
            }

            agent.emit('run:invoke', {
                sessionId,
                content: [{ type: 'text', text: prompt }],
                source: 'scheduler',
                metadata: {
                    trigger: 'cron',
                    scheduleId: schedule.id,
                    scheduleName: schedule.name,
                },
            });

            const workspacePath = schedule.workspacePath;
            const response = await withWorkspaceContext(workspacePath, () =>
                agent.generate(prompt, sessionId)
            );
            return response.content;
        });

        await manager.init();
        const ready = await waitForAgentStart();
        if (ready) {
            try {
                await manager.start();
                logger.info('Scheduler started successfully');
            } catch (error) {
                await manager.stop().catch(() => undefined);
                throw error;
            }
        } else {
            logger.warn('Scheduler start skipped because agent is not ready.');
        }

        schedulerManagerRegistry.set(agentId, manager);
        schedulerConfigRegistry.set(agentId, resolvedConfig);

        agent.services?.toolManager?.registerCleanup(async () => {
            await manager.stop();
            schedulerManagerRegistry.delete(agentId);
            schedulerConfigRegistry.delete(agentId);
        });

        return manager;
    })();

    schedulerManagerInitPromises.set(agentId, initPromise);
    try {
        return await initPromise;
    } finally {
        schedulerManagerInitPromises.delete(agentId);
    }
}

/**
 * Create scheduler tools from an existing manager instance.
 */
export function createSchedulerTools(manager: SchedulerManager): Tool[] {
    return [
        createCreateScheduleTool(async (_context) => manager),
        createListSchedulesTool(async (_context) => manager),
        createGetScheduleTool(async (_context) => manager),
        createUpdateScheduleTool(async (_context) => manager),
        createDeleteScheduleTool(async (_context) => manager),
        createTriggerScheduleTool(async (_context) => manager),
        createGetScheduleHistoryTool(async (_context) => manager),
    ];
}

/**
 * Scheduler tools factory for Dexto agents.
 */
export const schedulerToolsFactory: ToolFactory<SchedulerToolsConfig> = {
    configSchema: SchedulerToolsConfigSchema,
    metadata: {
        displayName: 'Scheduler Tools',
        description: 'Cron-based scheduling and automations',
        category: 'workflow',
    },
    create: (config) => {
        if (!defaultSchedulerConfig) {
            defaultSchedulerConfig = config;
        }

        const getManager: SchedulerManagerGetter = async (context) => {
            if (context.agent) {
                const agentId = context.agent.config?.agentId ?? 'default';
                schedulerConfigRegistry.set(agentId, config);
            }
            const manager = await ensureSchedulerManagerForAgent(
                context.agent,
                config,
                context.logger
            );
            if (!manager) {
                throw ToolError.configInvalid(
                    'scheduler-tools requires ToolExecutionContext.agent'
                );
            }
            return manager;
        };

        return [
            createCreateScheduleTool(getManager),
            createListSchedulesTool(getManager),
            createGetScheduleTool(getManager),
            createUpdateScheduleTool(getManager),
            createDeleteScheduleTool(getManager),
            createTriggerScheduleTool(getManager),
            createGetScheduleHistoryTool(getManager),
        ];
    },
};
