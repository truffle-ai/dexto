import { logger } from '@dexto/core';
import * as readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import {
    type ToolConfirmationEvent,
    type ToolConfirmationResponse,
    type ElicitationEvent,
    type ElicitationResponse,
    AgentEventBus,
} from '@dexto/core';
import { EventSubscriber } from '../../api/types.js';

// JSON Schema interfaces for elicitation
interface JSONSchema {
    type?: string;
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
    enum?: unknown[];
    description?: string;
}

interface JSONSchemaProperty {
    type?: string;
    description?: string;
    enum?: unknown[];
    default?: unknown;
}

/**
 * Unified CLI subscriber for user approval events (tool confirmations and elicitation)
 * Implements EventSubscriber pattern to listen to AgentEventBus for approval requests
 */
export class CLIUserApprovalSubscriber implements EventSubscriber {
    private agentEventBus?: AgentEventBus;

    constructor() {
        // No configuration needed - CLI always shows interactive prompts
    }

    /**
     * Subscribe to user approval events on the AgentEventBus
     */
    subscribe(eventBus: AgentEventBus): void {
        this.agentEventBus = eventBus;
        this.agentEventBus.on(
            'dexto:toolConfirmationRequest',
            this.handleToolConfirmationRequest.bind(this)
        );
        this.agentEventBus.on('dexto:elicitationRequest', this.handleElicitationRequest.bind(this));
    }

    /**
     * Handle tool confirmation request events from the AgentEventBus
     */
    private async handleToolConfirmationRequest(event: ToolConfirmationEvent): Promise<void> {
        try {
            logger.info(
                `Handling tool confirmation request for ${event.toolName}, executionId: ${event.executionId}`
            );

            // Display tool call using the logger's built-in method
            logger.toolCall(event.toolName, event.args);

            // Collect user input with arrow key navigation
            const approved = await this.collectToolConfirmation();

            // Send response back via AgentEventBus
            const response: ToolConfirmationResponse = {
                executionId: event.executionId,
                approved,
                rememberChoice: false, // CLI won't persist choice
                ...(event.sessionId && { sessionId: event.sessionId }),
            };

            this.sendToolConfirmationResponse(response);

            if (!approved) {
                logger.warn(`Tool '${event.toolName}' execution denied`);
            }
        } catch (error) {
            logger.error(`Error handling tool confirmation request: ${error}`);
            // Send denial response on error
            this.sendToolConfirmationResponse({
                executionId: event.executionId,
                approved: false,
                ...(event.sessionId && { sessionId: event.sessionId }),
            });
        }
    }

    /**
     * Handle elicitation request events from the AgentEventBus
     */
    private async handleElicitationRequest(event: ElicitationEvent): Promise<void> {
        try {
            logger.info(`Handling elicitation request, executionId: ${event.executionId}`);

            // Display elicitation request
            this.displayElicitationRequest(event);

            // Collect user response
            const result = await this.collectElicitationResponse(event);

            // Send response back via AgentEventBus
            const response: ElicitationResponse = {
                executionId: event.executionId,
                action: result.action,
                ...(result.data && { data: result.data }),
                ...(event.sessionId && { sessionId: event.sessionId }),
            };

            this.sendElicitationResponse(response);

            if (result.action === 'decline' || result.action === 'cancel') {
                logger.info(`Elicitation request ${result.action}d`);
            }
        } catch (error) {
            logger.error(`Error handling elicitation request: ${error}`);
            // Send cancel response on error
            this.sendElicitationResponse({
                executionId: event.executionId,
                action: 'cancel',
                ...(event.sessionId && { sessionId: event.sessionId }),
            });
        }
    }

    /**
     * Display elicitation request information
     */
    private displayElicitationRequest(event: ElicitationEvent): void {
        const serverInfo = event.serverName ? `\nServer: ${chalk.cyan(event.serverName)}` : '';

        console.log(
            boxen(
                `${chalk.blue('📋 Information Request')}\n\n` +
                    `${chalk.white(event.message)}${serverInfo}\n\n` +
                    `${chalk.gray('You can provide the requested information, decline, or cancel.')}`,
                {
                    padding: 1,
                    borderColor: 'blue',
                    title: '📋 Information Request',
                    titleAlignment: 'center',
                }
            )
        );
    }

    /**
     * Collect elicitation response from user
     */
    private async collectElicitationResponse(event: ElicitationEvent): Promise<{
        action: 'accept' | 'decline' | 'cancel';
        data?: object;
    }> {
        // Parse schema to determine what data to collect
        const schema = event.requestedSchema as JSONSchema;

        if (!schema || schema.type !== 'object' || !schema.properties) {
            // No specific data requested, just ask for accept/decline/cancel
            const action = await this.collectSimpleAction();
            return { action };
        }

        // Ask user if they want to provide the information
        const wantsToProvide = await this.collectInitialElicitationChoice();

        if (wantsToProvide === 'decline') {
            return { action: 'decline' };
        } else if (wantsToProvide === 'cancel') {
            return { action: 'cancel' };
        }

        // Collect the actual data
        const data = await this.collectSchemaData(schema);
        return { action: 'accept', data };
    }

    /**
     * Collect simple accept/decline/cancel choice
     */
    private collectSimpleAction(): Promise<'accept' | 'decline' | 'cancel'> {
        return new Promise((resolve) => {
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }

            let selection = 0; // 0=accept, 1=decline, 2=cancel

            console.log(
                boxen(
                    `${chalk.cyan('How would you like to respond?')}\n\n` +
                        `Use ${chalk.yellow('←/→')} arrow keys to select, ${chalk.yellow('Enter')} to confirm`,
                    {
                        padding: 1,
                        borderColor: 'cyan',
                        title: '🤔 Provide Information?',
                        titleAlignment: 'center',
                    }
                )
            );

            this.renderElicitationSelection(selection);

            const keypressHandler = (str: string, key: readline.Key) => {
                if (key.name === 'left') {
                    selection = Math.max(0, selection - 1);
                    this.renderElicitationSelection(selection);
                } else if (key.name === 'right') {
                    selection = Math.min(2, selection + 1);
                    this.renderElicitationSelection(selection);
                } else if (key.name === 'return') {
                    this.cleanupReadline(keypressHandler);
                    const actions: ('accept' | 'decline' | 'cancel')[] = [
                        'accept',
                        'decline',
                        'cancel',
                    ];
                    const chosen = actions[selection];

                    console.log(
                        boxen(chalk.green(`Action: ${chosen}`), {
                            padding: 1,
                            borderColor: 'green',
                            title: '✅ Selected',
                            titleAlignment: 'center',
                        })
                    );

                    if (chosen) {
                        resolve(chosen);
                    } else {
                        resolve('cancel');
                    }
                } else if (key.ctrl && key.name === 'c') {
                    this.cleanupReadline(keypressHandler);
                    resolve('cancel');
                }
            };

            process.stdin.on('keypress', keypressHandler);
        });
    }

    /**
     * Collect initial choice for elicitation (accept to continue, or decline/cancel)
     */
    private collectInitialElicitationChoice(): Promise<'continue' | 'decline' | 'cancel'> {
        return new Promise((resolve) => {
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }

            let selection = 0; // 0=continue, 1=decline, 2=cancel

            console.log(
                boxen(
                    `${chalk.cyan('Do you want to provide the requested information?')}\n\n` +
                        `Use ${chalk.yellow('←/→')} arrow keys to select, ${chalk.yellow('Enter')} to confirm`,
                    {
                        padding: 1,
                        borderColor: 'cyan',
                        title: '🤔 Provide Information?',
                        titleAlignment: 'center',
                    }
                )
            );

            this.renderInitialElicitationSelection(selection);

            const keypressHandler = (str: string, key: readline.Key) => {
                if (key.name === 'left') {
                    selection = Math.max(0, selection - 1);
                    this.renderInitialElicitationSelection(selection);
                } else if (key.name === 'right') {
                    selection = Math.min(2, selection + 1);
                    this.renderInitialElicitationSelection(selection);
                } else if (key.name === 'return') {
                    this.cleanupReadline(keypressHandler);
                    const actions: ('continue' | 'decline' | 'cancel')[] = [
                        'continue',
                        'decline',
                        'cancel',
                    ];
                    const chosen = actions[selection];
                    if (chosen) {
                        resolve(chosen);
                    } else {
                        resolve('cancel');
                    }
                } else if (key.ctrl && key.name === 'c') {
                    this.cleanupReadline(keypressHandler);
                    resolve('cancel');
                }
            };

            process.stdin.on('keypress', keypressHandler);
        });
    }

    /**
     * Collect data based on schema
     */
    private async collectSchemaData(schema: JSONSchema): Promise<Record<string, unknown>> {
        const data: Record<string, unknown> = {};
        const properties = schema.properties || {};
        const required = schema.required || [];

        console.log(
            boxen(chalk.blue('Please provide the following information:'), {
                padding: 1,
                borderColor: 'blue',
                title: '📝 Data Collection',
                titleAlignment: 'center',
            })
        );

        for (const [key, prop] of Object.entries(properties)) {
            const propSchema = prop as JSONSchemaProperty;
            const isRequired = required.includes(key);

            const value = await this.collectFieldValue(key, propSchema, isRequired);
            if (value !== null) {
                data[key] = value;
            }
        }

        return data;
    }

    /**
     * Collect value for a specific field
     */
    private collectFieldValue(
        fieldName: string,
        schema: JSONSchemaProperty,
        required: boolean
    ): Promise<unknown> {
        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const requiredMark = required ? chalk.red('*') : '';
            const typeInfo = schema.type ? chalk.gray(`(${schema.type})`) : '';
            const description = schema.description ? chalk.gray(`\n  ${schema.description}`) : '';

            const prompt = `${chalk.cyan(fieldName)}${requiredMark} ${typeInfo}${description}\n> `;

            rl.question(prompt, (answer) => {
                rl.close();

                // Handle empty values
                if (!answer.trim()) {
                    if (required) {
                        console.log(chalk.red('This field is required. Please try again.'));
                        this.collectFieldValue(fieldName, schema, required).then(resolve);
                        return;
                    } else {
                        resolve(null);
                        return;
                    }
                }

                // Type conversion
                let value: unknown = answer.trim();
                const stringValue = String(value);

                if (schema.type === 'number') {
                    const num = Number(stringValue);
                    if (isNaN(num)) {
                        console.log(chalk.red('Please enter a valid number.'));
                        this.collectFieldValue(fieldName, schema, required).then(resolve);
                        return;
                    }
                    value = num;
                } else if (schema.type === 'integer') {
                    const num = Number(stringValue);
                    if (isNaN(num) || !Number.isInteger(num)) {
                        console.log(chalk.red('Please enter a valid integer.'));
                        this.collectFieldValue(fieldName, schema, required).then(resolve);
                        return;
                    }
                    value = num;
                } else if (schema.type === 'boolean') {
                    const lower = stringValue.toLowerCase();
                    if (['true', 'yes', 'y', '1'].includes(lower)) {
                        value = true;
                    } else if (['false', 'no', 'n', '0'].includes(lower)) {
                        value = false;
                    } else {
                        console.log(chalk.red('Please enter true/false, yes/no, or y/n.'));
                        this.collectFieldValue(fieldName, schema, required).then(resolve);
                        return;
                    }
                }

                // Enum validation
                if (schema.enum && !schema.enum.includes(value)) {
                    console.log(chalk.red(`Please enter one of: ${schema.enum.join(', ')}`));
                    this.collectFieldValue(fieldName, schema, required).then(resolve);
                    return;
                }

                resolve(value);
            });
        });
    }

    /**
     * Collect tool confirmation with arrow key navigation
     */
    private collectToolConfirmation(): Promise<boolean> {
        return new Promise((resolve) => {
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }

            let selection = false; // Default to No/Deny for safety

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

            this.renderToolSelection(selection);

            const keypressHandler = (str: string, key: readline.Key) => {
                if (key.name === 'left') {
                    selection = true; // Left = Approve
                    this.renderToolSelection(selection);
                } else if (key.name === 'right') {
                    selection = false; // Right = Deny
                    this.renderToolSelection(selection);
                } else if (key.name === 'return') {
                    this.cleanupReadline(keypressHandler);

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

                    resolve(selection);
                } else if (key.ctrl && key.name === 'c') {
                    this.cleanupReadline(keypressHandler);
                    resolve(false);
                }
            };

            process.stdin.on('keypress', keypressHandler);
        });
    }

    /**
     * Render tool confirmation selection
     */
    private renderToolSelection(selection: boolean): void {
        process.stdout.write('\r\x1b[K');
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
     * Render elicitation action selection
     */
    private renderElicitationSelection(selection: number): void {
        // Clear the current line
        process.stdout.write('\r\x1b[K');

        const options = ['Accept', 'Decline', 'Cancel'];
        const colors = [chalk.green, chalk.yellow, chalk.red];

        let output = '';
        for (let i = 0; i < options.length; i++) {
            if (i === selection) {
                const colorFn = colors[i] || chalk.white;
                output += colorFn(`▶${options[i]}`);
            } else {
                output += chalk.gray(` ${options[i]}`);
            }
            if (i < options.length - 1) output += '   ';
        }
        process.stdout.write(output);
    }

    /**
     * Render initial elicitation choice selection
     */
    private renderInitialElicitationSelection(selection: number): void {
        process.stdout.write('\r\x1b[K');
        const options = ['Yes, provide information', 'Decline to provide', 'Cancel request'];
        const colors = [chalk.green, chalk.yellow, chalk.red];

        let output = '';
        for (let i = 0; i < options.length; i++) {
            if (i === selection) {
                const colorFn = colors[i] || chalk.white;
                output += colorFn(`▶${options[i]}`);
            } else {
                output += chalk.gray(` ${options[i]}`);
            }
            if (i < options.length - 1) output += '   ';
        }
        process.stdout.write(output);
    }

    /**
     * Clean up readline
     */
    private cleanupReadline(keypressHandler: (str: string, key: readline.Key) => void): void {
        process.stdin.removeListener('keypress', keypressHandler);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    }

    /**
     * Send tool confirmation response via AgentEventBus
     */
    private sendToolConfirmationResponse(response: ToolConfirmationResponse): void {
        if (!this.agentEventBus) {
            logger.error('AgentEventBus not available for sending confirmation response');
            return;
        }
        logger.debug(
            `CLI sending toolConfirmationResponse for executionId ${response.executionId}, approved=${response.approved}, sessionId=${response.sessionId}`
        );
        this.agentEventBus.emit('dexto:toolConfirmationResponse', response);
    }

    /**
     * Send elicitation response via AgentEventBus
     */
    private sendElicitationResponse(response: ElicitationResponse): void {
        if (!this.agentEventBus) {
            logger.error('AgentEventBus not available for sending elicitation response');
            return;
        }
        logger.debug(
            `CLI sending elicitationResponse for executionId ${response.executionId}, action=${response.action}, sessionId=${response.sessionId}`
        );
        this.agentEventBus.emit('dexto:elicitationResponse', response);
    }

    /**
     * Cleanup event listeners and resources
     */
    cleanup(): void {
        if (this.agentEventBus) {
            this.agentEventBus.removeAllListeners('dexto:toolConfirmationRequest');
            this.agentEventBus.removeAllListeners('dexto:elicitationRequest');
        }
    }
}
