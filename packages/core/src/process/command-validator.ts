/**
 * Command Validator
 *
 * Security-focused command validation for process execution
 */

import { ProcessConfig, CommandValidation } from './types.js';
import { logger } from '../logger/index.js';

const MAX_COMMAND_LENGTH = 10000; // 10K characters

// Dangerous command patterns that should be blocked
const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\//, // rm -rf /
    /:\(\)\{\s*:\|:&\s*\};:/, // Fork bomb
    /dd\s+if=.*of=\/dev\//, // dd to disk
    />\s*\/dev\/sd[a-z]/, // Write to disk
    /mkfs\./, // Format filesystem
    /wget.*\|\s*sh/, // wget | sh (download and execute)
    /curl.*\|\s*sh/, // curl | sh (download and execute)
    /\|\s*bash/, // Pipe to bash
    /eval\s+\$\(/, // eval $()
    /chmod\s+777\s+\//, // chmod 777 /
];

// Command injection patterns
const INJECTION_PATTERNS = [
    /;\s*rm\s+-rf/, // ; rm -rf
    /&&\s*rm\s+-rf/, // && rm -rf
    /\|\s*rm\s+-rf/, // | rm -rf
    /`.*rm.*`/, // backticks with rm
    /\$\(.*rm.*\)/, // $() with rm
];

/**
 * CommandValidator - Validates commands for security and policy compliance
 *
 * Security checks:
 * 1. Command length limits
 * 2. Dangerous command patterns
 * 3. Command injection detection
 * 4. Allowed/blocked command lists
 * 5. Shell metacharacter analysis
 */
export class CommandValidator {
    private config: ProcessConfig;

    constructor(config: ProcessConfig) {
        this.config = config;
        logger.debug(`CommandValidator initialized with security level: ${config.securityLevel}`);
    }

    /**
     * Validate a command for security and policy compliance
     */
    validateCommand(command: string): CommandValidation {
        // 1. Check for empty command
        if (!command || command.trim() === '') {
            return {
                isValid: false,
                error: 'Command cannot be empty',
            };
        }

        const trimmedCommand = command.trim();

        // 2. Check command length
        if (trimmedCommand.length > MAX_COMMAND_LENGTH) {
            return {
                isValid: false,
                error: `Command too long: ${trimmedCommand.length} characters. Maximum: ${MAX_COMMAND_LENGTH}`,
            };
        }

        // 3. Check against dangerous patterns (strict and moderate)
        if (this.config.securityLevel !== 'permissive') {
            for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(trimmedCommand)) {
                    return {
                        isValid: false,
                        error: `Command matches dangerous pattern: ${pattern.source}`,
                    };
                }
            }
        }

        // 4. Check for command injection attempts (all security levels)
        const injectionResult = this.detectInjection(trimmedCommand);
        if (!injectionResult.isValid) {
            return injectionResult;
        }

        // 5. Check against blocked commands list
        for (const blockedPattern of this.config.blockedCommands) {
            if (trimmedCommand.includes(blockedPattern)) {
                return {
                    isValid: false,
                    error: `Command is blocked: matches "${blockedPattern}"`,
                };
            }
        }

        // 6. Check against allowed commands list (if not empty)
        if (this.config.allowedCommands.length > 0) {
            const isAllowed = this.config.allowedCommands.some((allowedCmd) =>
                trimmedCommand.startsWith(allowedCmd)
            );

            if (!isAllowed) {
                return {
                    isValid: false,
                    error: `Command not in allowed list. Allowed: ${this.config.allowedCommands.join(', ')}`,
                };
            }
        }

        // 7. Determine if approval is required based on security level
        const requiresApproval = this.determineApprovalRequirement(trimmedCommand);

        return {
            isValid: true,
            normalizedCommand: trimmedCommand,
            requiresApproval,
        };
    }

    /**
     * Detect command injection attempts
     */
    private detectInjection(command: string): CommandValidation {
        // Check for obvious injection patterns
        for (const pattern of INJECTION_PATTERNS) {
            if (pattern.test(command)) {
                return {
                    isValid: false,
                    error: `Potential command injection detected: ${pattern.source}`,
                };
            }
        }

        // In strict mode, be more aggressive
        if (this.config.securityLevel === 'strict') {
            // Check for multiple commands chained together (except safe ones)
            const hasMultipleCommands = /;|\|{1,2}|&&/.test(command);
            if (hasMultipleCommands) {
                // Allow safe patterns like "cd dir && ls" or "command | grep pattern"
                const safePatterns = [
                    /^cd\s+.*&&\s+\w+/, // cd && command
                    /\|\s*grep/, // | grep
                    /\|\s*head/, // | head
                    /\|\s*tail/, // | tail
                    /\|\s*sort/, // | sort
                    /\|\s*uniq/, // | uniq
                ];

                const isSafe = safePatterns.some((pattern) => pattern.test(command));
                if (!isSafe) {
                    return {
                        isValid: false,
                        error: 'Multiple commands detected in strict mode. Use moderate or permissive mode if this is intentional.',
                    };
                }
            }
        }

        return {
            isValid: true,
        };
    }

    /**
     * Determine if a command requires approval
     */
    private determineApprovalRequirement(command: string): boolean {
        // Commands that modify system state always require approval
        const requiresApprovalPatterns = [
            /^rm\s+/, // rm (removal)
            /^git\s+push/, // git push
            /^git\s+commit/, // git commit
            /^npm\s+publish/, // npm publish
            /^docker\s+/, // docker commands
            /^sudo\s+/, // sudo commands
            /^chmod\s+/, // chmod
            /^chown\s+/, // chown
            /^mv\s+/, // move files
            /^cp\s+/, // copy files
        ];

        for (const pattern of requiresApprovalPatterns) {
            if (pattern.test(command)) {
                return true;
            }
        }

        // In strict mode, all commands require approval
        if (this.config.securityLevel === 'strict') {
            return true;
        }

        // In moderate mode, write operations require approval
        if (this.config.securityLevel === 'moderate') {
            const writePatterns = [
                />/, // output redirection
                />>/, // append redirection
                /tee\s+/, // tee command
            ];

            return writePatterns.some((pattern) => pattern.test(command));
        }

        // Permissive mode - no additional approval required
        return false;
    }

    /**
     * Get list of blocked commands
     */
    getBlockedCommands(): string[] {
        return [...this.config.blockedCommands];
    }

    /**
     * Get list of allowed commands
     */
    getAllowedCommands(): string[] {
        return [...this.config.allowedCommands];
    }

    /**
     * Get security level
     */
    getSecurityLevel(): string {
        return this.config.securityLevel;
    }
}
