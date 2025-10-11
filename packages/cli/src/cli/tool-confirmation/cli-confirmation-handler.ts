import { logger, ApprovalType } from '@dexto/core';
import * as readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import { AgentEventBus } from '@dexto/core';
import { EventSubscriber } from '../../api/types.js';

/**
 * CLI-specific subscriber for approval events
 * Implements EventSubscriber pattern to listen to AgentEventBus for approval requests
 */
export class CLIToolConfirmationSubscriber implements EventSubscriber {
    private agentEventBus?: AgentEventBus;

    constructor() {
        // No configuration needed - CLI always shows interactive prompts
    }

    /**
     * Subscribe to approval events on the AgentEventBus
     */
    subscribe(eventBus: AgentEventBus): void {
        this.agentEventBus = eventBus;
        this.agentEventBus.on('dexto:approvalRequest', this.handleApprovalRequest.bind(this));
    }

    /**
     * Handle approval request events from the AgentEventBus
     */
    private async handleApprovalRequest(event: {
        approvalId: string;
        type: string;
        sessionId?: string;
        timeout?: number;
        timestamp: Date;
        metadata: Record<string, any>;
    }): Promise<void> {
        try {
            if (event.type === ApprovalType.TOOL_CONFIRMATION) {
                await this.handleToolConfirmation(event);
            } else if (event.type === ApprovalType.ELICITATION) {
                await this.handleElicitation(event);
            } else {
                logger.debug(`[CLI] Ignoring unsupported approval type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`Error handling approval request: ${error}`);
            // Send denial response on error
            const errorResponse: any = {
                approvalId: event.approvalId,
                status: 'denied' as const,
            };

            if (event.sessionId !== undefined) {
                errorResponse.sessionId = event.sessionId;
            }

            this.sendApprovalResponse(errorResponse);
        }
    }

    /**
     * Handle tool confirmation approval
     */
    private async handleToolConfirmation(event: {
        approvalId: string;
        type: string;
        sessionId?: string;
        metadata: Record<string, any>;
    }): Promise<void> {
        const toolMetadata = event.metadata as {
            toolName: string;
            args: Record<string, unknown>;
            description?: string;
        };

        logger.info(
            `Handling tool confirmation request for ${toolMetadata.toolName}, approvalId: ${event.approvalId}`
        );

        // Display tool call using the logger's built-in method
        logger.toolCall(toolMetadata.toolName, toolMetadata.args);

        // Collect user input with arrow key navigation
        const approved = await this.collectArrowKeyInput();

        // Send response back via AgentEventBus
        const response: {
            approvalId: string;
            status: 'approved' | 'denied';
            sessionId?: string;
            data: { rememberChoice: boolean };
        } = {
            approvalId: event.approvalId,
            status: approved ? ('approved' as const) : ('denied' as const),
            data: {
                rememberChoice: false, // CLI won't persist choice
            },
        };

        if (event.sessionId !== undefined) {
            response.sessionId = event.sessionId;
        }

        this.sendApprovalResponse(response);

        if (!approved) {
            logger.warn(`Tool '${toolMetadata.toolName}' execution denied`);
        }
    }

    /**
     * Handle elicitation approval (form-based input from MCP servers)
     */
    private async handleElicitation(event: {
        approvalId: string;
        type: string;
        sessionId?: string;
        metadata: Record<string, any>;
    }): Promise<void> {
        const elicitationMetadata = event.metadata as {
            schema: any;
            prompt: string;
            serverName: string;
        };

        logger.info(
            `Handling elicitation request from MCP server '${elicitationMetadata.serverName}', approvalId: ${event.approvalId}`
        );

        // Display the elicitation prompt
        console.log(
            '\n' +
                boxen(chalk.cyan.bold('📝 Information Request from MCP Server'), {
                    padding: 1,
                    margin: 1,
                    borderStyle: 'round',
                    borderColor: 'cyan',
                })
        );

        console.log(chalk.white(`Server: ${chalk.yellow(elicitationMetadata.serverName)}`));
        console.log(chalk.white(`Message: ${chalk.white(elicitationMetadata.prompt)}\n`));

        // Collect form data based on schema
        const formData = await this.collectFormData(elicitationMetadata.schema);

        if (formData === null) {
            // User cancelled
            const cancelResponse: {
                approvalId: string;
                status: 'cancelled';
                sessionId?: string;
            } = {
                approvalId: event.approvalId,
                status: 'cancelled',
            };

            if (event.sessionId !== undefined) {
                cancelResponse.sessionId = event.sessionId;
            }

            this.sendApprovalResponse(cancelResponse);
            logger.info('Elicitation cancelled by user');
        } else {
            // User provided data
            const response: {
                approvalId: string;
                status: 'approved';
                sessionId?: string;
                data: { formData: Record<string, any> };
            } = {
                approvalId: event.approvalId,
                status: 'approved',
                data: { formData },
            };

            if (event.sessionId !== undefined) {
                response.sessionId = event.sessionId;
            }

            this.sendApprovalResponse(response);
            logger.info('Elicitation completed successfully');
        }
    }

    /**
     * Collect form data based on JSON Schema
     * Returns null if user cancels
     */
    private async collectFormData(schema: any): Promise<Record<string, any> | null> {
        const formData: Record<string, any> = {};

        if (!schema.properties || typeof schema.properties !== 'object') {
            logger.warn('Invalid schema: no properties found');
            return null;
        }

        const properties = schema.properties;
        const required = schema.required || [];

        for (const [fieldName, fieldSchema] of Object.entries(properties)) {
            const field = fieldSchema as any;
            const isRequired = required.includes(fieldName);
            const fieldType = field.type || 'string';

            // Display field prompt
            const requiredLabel = isRequired ? chalk.red('*') : '';
            console.log(
                chalk.cyan(`${fieldName}${requiredLabel}`) +
                    (field.description ? chalk.gray(` - ${field.description}`) : '')
            );

            // Collect input based on field type
            let value: any;

            if (fieldType === 'boolean') {
                value = await this.collectBooleanInput(fieldName);
            } else if (fieldType === 'number' || fieldType === 'integer') {
                value = await this.collectNumberInput(fieldName, fieldType === 'integer');
            } else if (field.enum && Array.isArray(field.enum)) {
                value = await this.collectEnumInput(fieldName, field.enum);
            } else {
                // Default to string input
                value = await this.collectStringInput(fieldName, isRequired);
            }

            if (value === null) {
                // User cancelled
                return null;
            }

            formData[fieldName] = value;
        }

        return formData;
    }

    /**
     * Collect string input from user
     */
    private collectStringInput(fieldName: string, required: boolean): Promise<string | null> {
        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const prompt = required
                ? `${fieldName}: `
                : `${fieldName} (optional, press Enter to skip): `;

            rl.question(prompt, (answer) => {
                rl.close();

                if (answer.toLowerCase() === 'cancel') {
                    resolve(null);
                    return;
                }

                if (!answer && required) {
                    console.log(chalk.red('This field is required'));
                    resolve(this.collectStringInput(fieldName, required));
                    return;
                }

                resolve(answer || '');
            });
        });
    }

    /**
     * Collect boolean input from user (yes/no)
     */
    private collectBooleanInput(fieldName: string): Promise<boolean | null> {
        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            rl.question(`${fieldName} (yes/no): `, (answer) => {
                rl.close();

                if (answer.toLowerCase() === 'cancel') {
                    resolve(null);
                    return;
                }

                const normalized = answer.toLowerCase().trim();
                if (normalized === 'yes' || normalized === 'y' || normalized === 'true') {
                    resolve(true);
                } else if (normalized === 'no' || normalized === 'n' || normalized === 'false') {
                    resolve(false);
                } else {
                    console.log(chalk.red('Please answer yes or no'));
                    resolve(this.collectBooleanInput(fieldName));
                }
            });
        });
    }

    /**
     * Collect number input from user
     */
    private collectNumberInput(fieldName: string, integer: boolean): Promise<number | null> {
        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const type = integer ? 'integer' : 'number';
            rl.question(`${fieldName} (${type}): `, (answer) => {
                rl.close();

                if (answer.toLowerCase() === 'cancel') {
                    resolve(null);
                    return;
                }

                const num = Number(answer);
                if (isNaN(num)) {
                    console.log(chalk.red(`Please enter a valid ${type}`));
                    resolve(this.collectNumberInput(fieldName, integer));
                    return;
                }

                if (integer && !Number.isInteger(num)) {
                    console.log(chalk.red('Please enter an integer'));
                    resolve(this.collectNumberInput(fieldName, integer));
                    return;
                }

                resolve(num);
            });
        });
    }

    /**
     * Collect enum input from user (select from list)
     */
    private collectEnumInput(fieldName: string, options: any[]): Promise<any | null> {
        return new Promise((resolve) => {
            console.log(chalk.gray('Available options:'));
            options.forEach((option, index) => {
                console.log(chalk.gray(`  ${index + 1}. ${option}`));
            });

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            rl.question(`${fieldName} (enter number or value): `, (answer) => {
                rl.close();

                if (answer.toLowerCase() === 'cancel') {
                    resolve(null);
                    return;
                }

                // Try as index first
                const index = parseInt(answer) - 1;
                if (!isNaN(index) && index >= 0 && index < options.length) {
                    resolve(options[index]);
                    return;
                }

                // Try as direct value
                const directMatch = options.find((opt) => String(opt) === answer);
                if (directMatch !== undefined) {
                    resolve(directMatch);
                    return;
                }

                console.log(chalk.red('Invalid selection'));
                resolve(this.collectEnumInput(fieldName, options));
            });
        });
    }

    /**
     * Send approval response via AgentEventBus
     */
    private sendApprovalResponse(response: {
        approvalId: string;
        status: 'approved' | 'denied' | 'cancelled';
        sessionId?: string;
        data?: Record<string, any>;
    }): void {
        if (!this.agentEventBus) {
            logger.error('AgentEventBus not available for sending approval response');
            return;
        }
        logger.debug(
            `CLI sending approvalResponse for approvalId ${response.approvalId}, status=${response.status}, sessionId=${response.sessionId ?? 'global'}`
        );
        this.agentEventBus.emit('dexto:approvalResponse', response);
    }

    /**
     * Collect user input with arrow key navigation
     * @returns Promise resolving to boolean (true for approve, false for deny)
     */
    private collectArrowKeyInput(): Promise<boolean> {
        return new Promise((resolve) => {
            // Configure readline for raw input
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }

            // Set initial selection (default to No/Deny for safety)
            let selection = false;

            // Display confirmation options
            console.log(
                boxen(
                    `${chalk.cyan('Confirm execution of this tool?')}\n\n` +
                        `Use ${chalk.yellow('←/→')} arrow keys to select, ${chalk.yellow('Enter')} to confirm`,
                    {
                        padding: 1,
                        borderColor: 'yellow',
                        title: '🔐 Tool Confirmation',
                        titleAlignment: 'center',
                    }
                )
            );

            // Initial render of options
            this.renderSelection(selection);

            // Handle keypress events
            const keypressHandler = (str: string, key: readline.Key) => {
                // Handle left/right arrow keys
                if (key.name === 'left') {
                    selection = true; // Left = Approve
                    this.renderSelection(selection);
                } else if (key.name === 'right') {
                    selection = false; // Right = Deny
                    this.renderSelection(selection);
                }
                // Handle Enter key to confirm selection
                else if (key.name === 'return') {
                    // Clean up
                    process.stdin.removeListener('keypress', keypressHandler);
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                    }

                    // Display confirmation result
                    console.log(
                        boxen(
                            selection
                                ? chalk.green('Tool execution approved')
                                : chalk.red('Tool execution denied'),
                            {
                                padding: 1,
                                borderColor: selection ? 'green' : 'red',
                                title: selection ? '✅ Approved' : '❌ Denied',
                                titleAlignment: 'center',
                            }
                        )
                    );

                    // Resolve with selection
                    resolve(selection);
                }
                // Handle Ctrl+C to abort
                else if (key.ctrl && key.name === 'c') {
                    // Clean up
                    process.stdin.removeListener('keypress', keypressHandler);
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                    }

                    console.log(
                        boxen(chalk.red('Tool execution aborted'), {
                            padding: 1,
                            borderColor: 'red',
                            title: '❌ Aborted',
                            titleAlignment: 'center',
                        })
                    );

                    // Resolve with false (deny)
                    resolve(false);
                }
            };

            // Register keypress handler
            process.stdin.on('keypress', keypressHandler);
        });
    }

    /**
     * Render the current selection state with a horizontal layout
     * @param selection Current selection (true = approve, false = deny)
     */
    private renderSelection(selection: boolean): void {
        // Clear previous line
        process.stdout.write('\r\x1b[K');
        // Render current selection with horizontal layout
        if (selection) {
            process.stdout.write(
                `${chalk.green('▶')}${chalk.green.bold('Approve')}   ${chalk.gray('Deny')}`
            );
        } else {
            process.stdout.write(
                ` ${chalk.gray('Approve')}  ${chalk.red('▶')}${chalk.red.bold('Deny')}`
            );
        }
    }

    /**
     * Cleanup event listeners and resources
     */
    cleanup(): void {
        if (this.agentEventBus) {
            this.agentEventBus.removeAllListeners('dexto:approvalRequest');
        }
    }
}
