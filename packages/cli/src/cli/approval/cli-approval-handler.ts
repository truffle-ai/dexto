import * as readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import { logger, ApprovalType, ApprovalStatus, DenialReason } from '@dexto/core';
import type { ApprovalHandler, ApprovalRequest, ApprovalResponse } from '@dexto/core';

/**
 * Creates a CLI-based approval handler that prompts users in the terminal
 * Implements synchronous blocking prompts for approval requests
 */
export function createCLIApprovalHandler(timeout: number): ApprovalHandler {
    // Track pending approvals for cancellation
    const pendingApprovals = new Map<string, AbortController>();

    /**
     * Main handler function - processes approval requests
     */
    const handler = async (request: ApprovalRequest): Promise<ApprovalResponse> => {
        const abortController = new AbortController();
        pendingApprovals.set(request.approvalId, abortController);

        try {
            // Set up timeout
            const timeoutId = setTimeout(() => {
                abortController.abort();
            }, timeout);

            // Handle different approval types
            let response: ApprovalResponse;

            switch (request.type) {
                case ApprovalType.TOOL_CONFIRMATION:
                    response = await handleToolConfirmation(request, abortController.signal);
                    break;

                case ApprovalType.ELICITATION:
                    response = await handleElicitation(request, abortController.signal);
                    break;

                default:
                    logger.warn(`CLI approval handler received unsupported type: ${request.type}`);
                    response = {
                        approvalId: request.approvalId,
                        status: ApprovalStatus.DENIED,
                        reason: DenialReason.SYSTEM_DENIED,
                        message: `Unsupported approval type: ${request.type}`,
                    };
            }

            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            if (abortController.signal.aborted) {
                // Timeout or manual cancellation
                return {
                    approvalId: request.approvalId,
                    status: ApprovalStatus.DENIED,
                    reason: DenialReason.TIMEOUT,
                    message: 'Request timed out or was cancelled',
                };
            }

            // Unexpected error
            logger.error(
                `Error handling approval request: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
                approvalId: request.approvalId,
                status: ApprovalStatus.DENIED,
                reason: DenialReason.SYSTEM_DENIED,
                message: `Error: ${error instanceof Error ? error.message : String(error)}`,
            };
        } finally {
            pendingApprovals.delete(request.approvalId);
        }
    };

    /**
     * Cancel a specific pending approval
     */
    handler.cancel = (approvalId: string): void => {
        const controller = pendingApprovals.get(approvalId);
        if (controller) {
            controller.abort();
            pendingApprovals.delete(approvalId);
        }
    };

    /**
     * Cancel all pending approvals
     */
    handler.cancelAll = (): void => {
        for (const controller of pendingApprovals.values()) {
            controller.abort();
        }
        pendingApprovals.clear();
    };

    /**
     * Get list of pending approval IDs
     */
    handler.getPending = (): string[] => {
        return Array.from(pendingApprovals.keys());
    };

    return handler;
}

/**
 * Handle tool confirmation approval
 */
async function handleToolConfirmation(
    request: ApprovalRequest,
    signal: AbortSignal
): Promise<ApprovalResponse> {
    // Type guard ensures request.type === 'tool_confirmation'
    if (request.type !== ApprovalType.TOOL_CONFIRMATION) {
        throw new Error('Invalid request type for tool confirmation');
    }
    const { toolName, args, description } = request.metadata as {
        toolName: string;
        args: Record<string, unknown>;
        description?: string;
    };

    logger.info(`Tool confirmation request for ${toolName}, approvalId: ${request.approvalId}`);

    // Display tool call
    logger.toolCall(toolName, args);
    if (description) {
        console.log(chalk.gray(`Description: ${description}`));
    }

    // Prompt user for approval
    const approved = await collectArrowKeyInput(signal);

    if (approved) {
        return {
            approvalId: request.approvalId,
            status: ApprovalStatus.APPROVED,
            data: {
                rememberChoice: false, // CLI doesn't persist choices
            },
        };
    } else {
        return {
            approvalId: request.approvalId,
            status: ApprovalStatus.DENIED,
            reason: DenialReason.USER_DENIED,
            message: 'User denied tool execution',
            data: {
                rememberChoice: false,
            },
        };
    }
}

/**
 * Handle elicitation approval (form-based input from MCP servers)
 */
async function handleElicitation(
    request: ApprovalRequest,
    signal: AbortSignal
): Promise<ApprovalResponse> {
    // Type guard ensures request.type === 'elicitation'
    if (request.type !== ApprovalType.ELICITATION) {
        throw new Error('Invalid request type for elicitation');
    }
    const { schema, prompt, serverName } = request.metadata as {
        schema: any;
        prompt: string;
        serverName: string;
        context?: Record<string, any>;
    };

    logger.info(
        `Elicitation request from MCP server '${serverName}', approvalId: ${request.approvalId}`
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

    console.log(chalk.white(`Server: ${chalk.yellow(serverName)}`));
    console.log(chalk.white(`Message: ${chalk.white(prompt)}\n`));

    // Collect form data based on schema
    const formData = await collectFormData(schema, signal);

    if (formData === null) {
        // User cancelled
        return {
            approvalId: request.approvalId,
            status: ApprovalStatus.CANCELLED,
            reason: DenialReason.USER_CANCELLED,
            message: 'User cancelled the elicitation request',
        };
    }

    // User provided data
    return {
        approvalId: request.approvalId,
        status: ApprovalStatus.APPROVED,
        data: { formData },
    };
}

/**
 * Collect form data based on JSON Schema
 * Returns null if user cancels
 */
async function collectFormData(
    schema: any,
    signal: AbortSignal
): Promise<Record<string, any> | null> {
    const formData: Record<string, any> = {};

    if (!schema.properties || typeof schema.properties !== 'object') {
        logger.warn('Invalid schema: no properties found');
        return null;
    }

    const properties = schema.properties;
    const required = schema.required || [];

    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
        if (signal.aborted) {
            return null;
        }

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
            value = await collectBooleanInput(fieldName, isRequired, signal);
        } else if (fieldType === 'number' || fieldType === 'integer') {
            value = await collectNumberInput(
                fieldName,
                fieldType === 'integer',
                isRequired,
                signal
            );
        } else if (field.enum && Array.isArray(field.enum)) {
            value = await collectEnumInput(fieldName, field.enum, isRequired, signal);
        } else {
            // Default to string input
            value = await collectStringInput(fieldName, isRequired, signal);
        }

        if (value === null) {
            // User cancelled
            return null;
        }

        // Only assign if value is not undefined (allows skipping optional fields)
        if (value !== undefined) {
            formData[fieldName] = value;
        }
    }

    return formData;
}

/**
 * Collect user input with arrow key navigation
 * @returns Promise resolving to boolean (true for approve, false for deny)
 */
function collectArrowKeyInput(signal: AbortSignal): Promise<boolean> {
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
        renderSelection(selection);

        // Cleanup function
        const cleanup = () => {
            process.stdin.removeListener('keypress', keypressHandler);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
        };

        // Handle abort signal
        const abortHandler = () => {
            cleanup();
            resolve(false);
        };
        signal.addEventListener('abort', abortHandler);

        // Handle keypress events
        const keypressHandler = (_str: string, key: readline.Key) => {
            // Handle left/right arrow keys
            if (key.name === 'left') {
                selection = true; // Left = Approve
                renderSelection(selection);
            } else if (key.name === 'right') {
                selection = false; // Right = Deny
                renderSelection(selection);
            }
            // Handle Enter key to confirm selection
            else if (key.name === 'return') {
                cleanup();
                signal.removeEventListener('abort', abortHandler);

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

                resolve(selection);
            }
            // Handle Ctrl+C to abort
            else if (key.ctrl && key.name === 'c') {
                cleanup();
                signal.removeEventListener('abort', abortHandler);

                console.log(
                    boxen(chalk.red('Tool execution aborted'), {
                        padding: 1,
                        borderColor: 'red',
                        title: '❌ Aborted',
                        titleAlignment: 'center',
                    })
                );

                resolve(false);
            }
        };

        // Register keypress handler
        process.stdin.on('keypress', keypressHandler);
    });
}

/**
 * Render the current selection state with a horizontal layout
 */
function renderSelection(selection: boolean): void {
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
 * Collect string input from user
 */
function collectStringInput(
    fieldName: string,
    required: boolean,
    signal: AbortSignal
): Promise<string | undefined | null> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve(null);
            return;
        }

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
                resolve(collectStringInput(fieldName, required, signal));
                return;
            }

            // Return undefined for optional skipped fields, empty string for provided empty input
            if (!answer && !required) {
                resolve(undefined);
                return;
            }

            resolve(answer);
        });
    });
}

/**
 * Collect boolean input from user (yes/no)
 */
function collectBooleanInput(
    fieldName: string,
    required: boolean,
    signal: AbortSignal
): Promise<boolean | undefined | null> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve(null);
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const prompt = required
            ? `${fieldName} (yes/no): `
            : `${fieldName} (yes/no, press Enter to skip): `;

        rl.question(prompt, (answer) => {
            rl.close();

            if (answer.toLowerCase() === 'cancel') {
                resolve(null);
                return;
            }

            const normalized = answer.toLowerCase().trim();

            // Allow skipping optional fields
            if (!normalized && !required) {
                resolve(undefined);
                return;
            }

            if (!normalized && required) {
                console.log(chalk.red('This field is required'));
                resolve(collectBooleanInput(fieldName, required, signal));
                return;
            }

            if (normalized === 'yes' || normalized === 'y' || normalized === 'true') {
                resolve(true);
            } else if (normalized === 'no' || normalized === 'n' || normalized === 'false') {
                resolve(false);
            } else {
                console.log(chalk.red('Please answer yes or no'));
                resolve(collectBooleanInput(fieldName, required, signal));
            }
        });
    });
}

/**
 * Collect number input from user
 */
function collectNumberInput(
    fieldName: string,
    integer: boolean,
    required: boolean,
    signal: AbortSignal
): Promise<number | undefined | null> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve(null);
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const type = integer ? 'integer' : 'number';
        const prompt = required
            ? `${fieldName} (${type}): `
            : `${fieldName} (${type}, press Enter to skip): `;

        rl.question(prompt, (answer) => {
            rl.close();

            if (answer.toLowerCase() === 'cancel') {
                resolve(null);
                return;
            }

            // Allow skipping optional fields
            if (!answer.trim() && !required) {
                resolve(undefined);
                return;
            }

            if (!answer.trim() && required) {
                console.log(chalk.red('This field is required'));
                resolve(collectNumberInput(fieldName, integer, required, signal));
                return;
            }

            const num = Number(answer);
            if (isNaN(num)) {
                console.log(chalk.red(`Please enter a valid ${type}`));
                resolve(collectNumberInput(fieldName, integer, required, signal));
                return;
            }

            if (integer && !Number.isInteger(num)) {
                console.log(chalk.red('Please enter an integer'));
                resolve(collectNumberInput(fieldName, integer, required, signal));
                return;
            }

            resolve(num);
        });
    });
}

/**
 * Collect enum input from user (select from list)
 */
function collectEnumInput(
    fieldName: string,
    options: any[],
    required: boolean,
    signal: AbortSignal
): Promise<any | null> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve(null);
            return;
        }

        console.log(chalk.gray('Available options:'));
        options.forEach((option, index) => {
            console.log(chalk.gray(`  ${index + 1}. ${option}`));
        });

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const prompt = required
            ? `${fieldName} (enter number or value): `
            : `${fieldName} (enter number or value, press Enter to skip): `;

        rl.question(prompt, (answer) => {
            rl.close();

            if (answer.toLowerCase() === 'cancel') {
                resolve(null);
                return;
            }

            // Allow skipping optional fields
            if (!answer.trim() && !required) {
                resolve(undefined);
                return;
            }

            if (!answer.trim() && required) {
                console.log(chalk.red('This field is required'));
                resolve(collectEnumInput(fieldName, options, required, signal));
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
            resolve(collectEnumInput(fieldName, options, required, signal));
        });
    });
}
