import { randomUUID } from 'crypto';
import {
    UserApprovalProviderInterface,
    ToolExecutionDetails,
    ToolConfirmationResponse,
    ElicitationDetails,
    ElicitationResponse,
} from './types.js';
import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';
import { logger } from '@core/logger/index.js';
import { AgentEventBus } from '../../events/index.js';
import { ToolError } from '../errors.js';

/**
 * Unified provider for user approvals including both tool confirmations and elicitation.
 * Extends the existing tool confirmation system to support MCP elicitation requests.
 */
export class UserApprovalProvider implements UserApprovalProviderInterface {
    private pendingConfirmations = new Map<
        string,
        {
            resolve: (approved: boolean) => void;
            reject: (error: Error) => void;
            toolName: string;
            sessionId?: string;
        }
    >();
    private pendingElicitations = new Map<
        string,
        {
            resolve: (result: ElicitationResponse) => void;
            reject: (error: Error) => void;
            details: ElicitationDetails;
        }
    >();
    private confirmationTimeout: number;
    private agentEventBus: AgentEventBus;

    constructor(
        public allowedToolsProvider: IAllowedToolsProvider,
        agentEventBus: AgentEventBus,
        options: {
            confirmationTimeout: number;
        }
    ) {
        this.agentEventBus = agentEventBus;
        this.confirmationTimeout = options.confirmationTimeout;

        // Listen for confirmation responses
        this.agentEventBus.on(
            'dexto:toolConfirmationResponse',
            this.handleConfirmationResponse.bind(this)
        );

        // Listen for elicitation responses
        this.agentEventBus.on(
            'dexto:elicitationResponse',
            this.handleElicitationResponse.bind(this)
        );
    }

    async requestConfirmation(details: ToolExecutionDetails): Promise<boolean> {
        // Check if tool is in allowed list first
        const isAllowed = await this.allowedToolsProvider.isToolAllowed(
            details.toolName,
            details.sessionId
        );

        if (isAllowed) {
            logger.info(
                `Tool '${details.toolName}' already allowed for session '${details.sessionId ?? 'global'}' – skipping confirmation.`
            );
            return true;
        }

        const executionId = randomUUID();
        const event = {
            toolName: details.toolName,
            args: details.args,
            ...(details.description && { description: details.description }),
            executionId,
            timestamp: new Date(),
            ...(details.sessionId && { sessionId: details.sessionId }),
        };

        logger.info(
            `Tool confirmation requested for ${details.toolName}, executionId: ${executionId}, sessionId: ${details.sessionId}`
        );

        return new Promise<boolean>((resolve, reject) => {
            // Set timeout
            const timeout = setTimeout(() => {
                const timeoutResponse: ToolConfirmationResponse = {
                    executionId,
                    approved: false,
                    rememberChoice: false,
                    ...(details.sessionId && { sessionId: details.sessionId }),
                };

                logger.warn(
                    `Tool confirmation timeout for ${details.toolName}, executionId: ${executionId}`
                );

                // Clean up pending map before emitting to avoid re-processing
                this.pendingConfirmations.delete(executionId);

                // Notify application layers
                this.agentEventBus.emit('dexto:toolConfirmationResponse', timeoutResponse);

                reject(
                    ToolError.confirmationTimeout(
                        details.toolName,
                        this.confirmationTimeout,
                        details.sessionId
                    )
                );
            }, this.confirmationTimeout);

            // Store the promise resolvers with cleanup
            this.pendingConfirmations.set(executionId, {
                resolve: (approved: boolean) => {
                    clearTimeout(timeout);
                    this.pendingConfirmations.delete(executionId);
                    resolve(approved);
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    this.pendingConfirmations.delete(executionId);
                    reject(error);
                },
                toolName: details.toolName,
                ...(details.sessionId && { sessionId: details.sessionId }),
            });

            // Emit the confirmation request event
            this.agentEventBus.emit('dexto:toolConfirmationRequest', event);
        });
    }

    async requestElicitation(details: ElicitationDetails): Promise<ElicitationResponse> {
        const executionId = randomUUID();
        const event = {
            message: details.message,
            requestedSchema: details.requestedSchema,
            executionId,
            timestamp: new Date(),
            ...(details.sessionId && { sessionId: details.sessionId }),
            ...(details.serverName && { serverName: details.serverName }),
        };

        logger.info(
            `Elicitation requested, executionId: ${executionId}, sessionId: ${details.sessionId}`
        );

        return new Promise<ElicitationResponse>((resolve, reject) => {
            // Set timeout
            const timeout = setTimeout(() => {
                const timeoutResponse: ElicitationResponse = {
                    executionId,
                    action: 'cancel',
                    ...(details.sessionId && { sessionId: details.sessionId }),
                };

                logger.warn(`Elicitation timeout, executionId: ${executionId}`);

                // Clean up pending map before emitting
                this.pendingElicitations.delete(executionId);

                // Notify application layers
                this.agentEventBus.emit('dexto:elicitationResponse', timeoutResponse);

                reject(ToolError.elicitationTimeout(this.confirmationTimeout, details.sessionId));
            }, this.confirmationTimeout);

            // Store the promise resolvers with cleanup
            this.pendingElicitations.set(executionId, {
                resolve: (result: ElicitationResponse) => {
                    clearTimeout(timeout);
                    this.pendingElicitations.delete(executionId);
                    resolve(result);
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    this.pendingElicitations.delete(executionId);
                    reject(error);
                },
                details,
            });

            // Emit the elicitation request event
            this.agentEventBus.emit('dexto:elicitationRequest', event);
        });
    }

    async handleConfirmationResponse(response: ToolConfirmationResponse): Promise<void> {
        const pending = this.pendingConfirmations.get(response.executionId);
        if (!pending) {
            logger.warn(
                `Received toolConfirmationResponse for unknown executionId ${response.executionId}`
            );
            return;
        }

        // Remove from pending map immediately
        this.pendingConfirmations.delete(response.executionId);

        // If user wants to remember this choice, add to allowed tools
        if (response.approved && response.rememberChoice) {
            await this.allowedToolsProvider.allowTool(pending.toolName, response.sessionId);
            logger.info(
                `Tool '${pending.toolName}' added to allowed tools for session '${response.sessionId ?? 'global'}' (remember choice selected)`
            );
        }

        logger.info(
            `Tool confirmation ${response.approved ? 'approved' : 'denied'} for ${pending.toolName}, executionId: ${response.executionId}, sessionId: ${response.sessionId ?? 'global'}`
        );

        pending.resolve(response.approved);
    }

    async handleElicitationResponse(response: ElicitationResponse): Promise<void> {
        const pending = this.pendingElicitations.get(response.executionId);
        if (!pending) {
            logger.warn(
                `Received elicitationResponse for unknown executionId ${response.executionId}`
            );
            return;
        }

        // Remove from pending map immediately
        this.pendingElicitations.delete(response.executionId);

        logger.info(
            `Elicitation ${response.action} for executionId: ${response.executionId}, sessionId: ${response.sessionId ?? 'global'}`
        );

        pending.resolve(response);
    }

    /**
     * Get list of pending confirmation requests
     */
    getPendingConfirmations(): string[] {
        return Array.from(this.pendingConfirmations.keys());
    }

    /**
     * Get list of pending elicitation requests
     */
    getPendingElicitations(): string[] {
        return Array.from(this.pendingElicitations.keys());
    }

    /**
     * Cancel a pending confirmation request
     */
    cancelConfirmation(executionId: string): void {
        const pending = this.pendingConfirmations.get(executionId);
        if (pending) {
            pending.reject(
                ToolError.confirmationCancelled(pending.toolName, 'individual request cancelled')
            );
            this.pendingConfirmations.delete(executionId);
        }
    }

    /**
     * Cancel a pending elicitation request
     */
    cancelElicitation(executionId: string): void {
        const pending = this.pendingElicitations.get(executionId);
        if (pending) {
            pending.reject(ToolError.elicitationCancelled('individual request cancelled'));
            this.pendingElicitations.delete(executionId);
        }
    }

    /**
     * Cancel all pending requests
     */
    cancelAllRequests(): void {
        for (const [_executionId, pending] of this.pendingConfirmations) {
            pending.reject(
                ToolError.confirmationCancelled(pending.toolName, 'all requests cancelled')
            );
        }
        this.pendingConfirmations.clear();

        for (const [_executionId, pending] of this.pendingElicitations) {
            pending.reject(ToolError.elicitationCancelled('all requests cancelled'));
        }
        this.pendingElicitations.clear();
    }
}
