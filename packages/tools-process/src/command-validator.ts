/**
 * Command Validator
 *
 * Security-focused command validation for process execution
 */

import { ProcessConfig, CommandValidation } from './types.js';
import type { Logger } from '@dexto/core';

const MAX_COMMAND_LENGTH = 10000; // 10K characters

// Dangerous command patterns that should be blocked
// Validated against common security vulnerabilities and dangerous command patterns
const DANGEROUS_PATTERNS = [
    // File system destruction
    /rm\s+-rf\s+\//, // rm -rf /
    /rm\s+-rf\s+\/\s*$/, // rm -rf / (end of line)
    /rm\s+-rf\s+\/\s*2/, // rm -rf / 2>/dev/null (with error suppression)

    // Fork bomb variations
    /:\(\)\{\s*:\|:&\s*\};:/, // Classic fork bomb
    /:\(\)\{\s*:\|:&\s*\};/, // Fork bomb without final colon
    /:\(\)\{\s*:\|:&\s*\}/, // Fork bomb without semicolon

    // Disk operations
    /dd\s+if=.*of=\/dev\//, // dd to disk devices
    /dd\s+if=\/dev\/zero.*of=\/dev\//, // dd zero to disk
    /dd\s+if=\/dev\/urandom.*of=\/dev\//, // dd random to disk
    />\s*\/dev\/sd[a-z]/, // Write to disk devices
    />>\s*\/dev\/sd[a-z]/, // Append to disk devices

    // Filesystem operations
    /mkfs\./, // Format filesystem
    /mkfs\s+/, // Format filesystem with space
    /fdisk\s+\/dev\/sd[a-z]/, // Partition disk
    /parted\s+\/dev\/sd[a-z]/, // Partition disk with parted

    // Download and execute patterns
    // Note: curl | python and wget | python are intentionally NOT blocked
    // as they are commonly used for legitimate data fetching and parsing
    /wget.*\|\s*sh/, // wget | sh
    /wget.*\|\s*bash/, // wget | bash
    /curl.*\|\s*sh/, // curl | sh
    /curl.*\|\s*bash/, // curl | bash

    // Shell execution
    /\|\s*bash/, // Pipe to bash
    /\|\s*sh/, // Pipe to sh
    /\|\s*zsh/, // Pipe to zsh
    /\|\s*fish/, // Pipe to fish

    // Command evaluation
    /eval\s+\$\(/, // eval $()
    /eval\s+`/, // eval backticks
    /eval\s+"/, // eval double quotes
    /eval\s+'/, // eval single quotes

    // Permission changes
    /chmod\s+777\s+\//, // chmod 777 /
    /chmod\s+777\s+\/\s*$/, // chmod 777 / (end of line)
    /chmod\s+-R\s+777\s+\//, // chmod -R 777 /
    /chown\s+-R\s+root\s+\//, // chown -R root /

    // Network operations
    /nc\s+-l\s+-p\s+\d+/, // netcat listener
    /ncat\s+-l\s+-p\s+\d+/, // ncat listener
    /socat\s+.*LISTEN/, // socat listener

    // Process manipulation
    /killall\s+-9/, // killall -9
    /pkill\s+-9/, // pkill -9
    /kill\s+-9\s+-1/, // kill -9 -1 (kill all processes)

    // System shutdown/reboot
    /shutdown\s+now/, // shutdown now
    /reboot/, // reboot
    /halt/, // halt
    /poweroff/, // poweroff

    // Memory operations
    /echo\s+3\s*>\s*\/proc\/sys\/vm\/drop_caches/, // Clear page cache
    /sync\s*;\s*echo\s+3\s*>\s*\/proc\/sys\/vm\/drop_caches/, // Sync and clear cache

    // Network interface manipulation
    /ifconfig\s+.*down/, // Bring interface down
    /ip\s+link\s+set\s+.*down/, // Bring interface down with ip

    // Package manager operations
    /apt\s+remove\s+--purge\s+.*/, // Remove packages
    /yum\s+remove\s+.*/, // Remove packages
    /dnf\s+remove\s+.*/, // Remove packages
    /pacman\s+-R\s+.*/, // Remove packages
];

// Command injection patterns
// Note: We don't block compound commands with && here, as they're handled by
// the compound command detection logic in determineApprovalRequirement()
const INJECTION_PATTERNS = [
    // Command chaining with dangerous commands using semicolon (more suspicious)
    /;\s*rm\s+-rf/, // ; rm -rf
    /;\s*chmod\s+777/, // ; chmod 777
    /;\s*chown\s+root/, // ; chown root

    // Command substitution with dangerous commands
    /`.*rm.*`/, // backticks with rm
    /\$\(.*rm.*\)/, // $() with rm
    /`.*chmod.*`/, // backticks with chmod
    /\$\(.*chmod.*\)/, // $() with chmod
    /`.*chown.*`/, // backticks with chown
    /\$\(.*chown.*\)/, // $() with chown

    // Multiple command separators
    /;\s*;\s*/, // Multiple semicolons
    /&&\s*&&\s*/, // Multiple && operators
    /\|\|\s*\|\|\s*/, // Multiple || operators

    // Redirection with dangerous commands
    /rm\s+.*>\s*\/dev\/null/, // rm with output redirection
    /chmod\s+.*>\s*\/dev\/null/, // chmod with output redirection
    /chown\s+.*>\s*\/dev\/null/, // chown with output redirection

    // Environment variable manipulation
    /\$[A-Z_]+\s*=\s*.*rm/, // Environment variable with rm
    /\$[A-Z_]+\s*=\s*.*chmod/, // Environment variable with chmod
    /\$[A-Z_]+\s*=\s*.*chown/, // Environment variable with chown
];

// Commands that require approval
const REQUIRES_APPROVAL_PATTERNS = [
    // File operations
    /^rm\s+/, // rm (removal)
    /^mv\s+/, // move files
    /^cp\s+/, // copy files
    /^chmod\s+/, // chmod
    /^chown\s+/, // chown
    /^chgrp\s+/, // chgrp
    /^ln\s+/, // create links
    /^unlink\s+/, // unlink files

    // Git operations
    /^git\s+push/, // git push
    /^git\s+commit/, // git commit
    /^git\s+reset/, // git reset
    /^git\s+rebase/, // git rebase
    /^git\s+merge/, // git merge
    /^git\s+checkout/, // git checkout
    /^git\s+branch/, // git branch
    /^git\s+tag/, // git tag

    // Package management
    /^npm\s+publish/, // npm publish
    /^npm\s+uninstall/, // npm uninstall
    /^yarn\s+publish/, // yarn publish
    /^yarn\s+remove/, // yarn remove
    /^pip\s+install/, // pip install
    /^pip\s+uninstall/, // pip uninstall
    /^apt\s+install/, // apt install
    /^apt\s+remove/, // apt remove
    /^yum\s+install/, // yum install
    /^yum\s+remove/, // yum remove
    /^dnf\s+install/, // dnf install
    /^dnf\s+remove/, // dnf remove
    /^pacman\s+-S/, // pacman install
    /^pacman\s+-R/, // pacman remove

    // Container operations
    /^docker\s+/, // docker commands
    /^podman\s+/, // podman commands
    /^kubectl\s+/, // kubectl commands

    // System operations
    /^sudo\s+/, // sudo commands
    /^su\s+/, // su commands
    /^systemctl\s+/, // systemctl commands
    /^service\s+/, // service commands
    /^mount\s+/, // mount commands
    /^umount\s+/, // umount commands
    /^fdisk\s+/, // fdisk commands
    /^parted\s+/, // parted commands
    /^mkfs\s+/, // mkfs commands
    /^fsck\s+/, // fsck commands

    // Network operations
    /^iptables\s+/, // iptables commands
    /^ufw\s+/, // ufw commands
    /^firewall-cmd\s+/, // firewall-cmd commands
    /^sshd\s+/, // sshd commands
    /^ssh\s+/, // ssh commands
    /^scp\s+/, // scp commands
    /^rsync\s+/, // rsync commands

    // Process management
    /^kill\s+/, // kill commands
    /^killall\s+/, // killall commands
    /^pkill\s+/, // pkill commands
    /^nohup\s+/, // nohup commands
    /^screen\s+/, // screen commands
    /^tmux\s+/, // tmux commands

    // Database operations
    /^mysql\s+/, // mysql commands
    /^psql\s+/, // psql commands
    /^sqlite3\s+/, // sqlite3 commands
    /^mongodb\s+/, // mongodb commands
    /^redis-cli\s+/, // redis-cli commands
];

// Safe command patterns for strict mode
const SAFE_PATTERNS = [
    // Directory navigation with commands
    /^cd\s+.*&&\s+\w+/, // cd && command
    /^cd\s+.*;\s+\w+/, // cd ; command

    // Safe pipe operations
    /\|\s*grep/, // | grep
    /\|\s*head/, // | head
    /\|\s*tail/, // | tail
    /\|\s*sort/, // | sort
    /\|\s*uniq/, // | uniq
    /\|\s*wc/, // | wc
    /\|\s*cat/, // | cat
    /\|\s*less/, // | less
    /\|\s*more/, // | more
    /\|\s*awk/, // | awk
    /\|\s*sed/, // | sed
    /\|\s*cut/, // | cut
    /\|\s*tr/, // | tr
    /\|\s*xargs/, // | xargs

    // Safe redirection
    /^ls\s+.*>/, // ls with output redirection
    /^find\s+.*>/, // find with output redirection
    /^grep\s+.*>/, // grep with output redirection
    /^cat\s+.*>/, // cat with output redirection
];

// Write operation patterns for moderate mode
const WRITE_PATTERNS = [
    // Output redirection
    />/, // output redirection
    />>/, // append redirection
    /2>/, // error redirection
    /2>>/, // error append redirection
    /&>/, // both output and error redirection
    /&>>/, // both output and error append redirection

    // File operations
    /tee\s+/, // tee command
    /touch\s+/, // touch command
    /mkdir\s+/, // mkdir command
    /rmdir\s+/, // rmdir command

    // Text editors
    /vim\s+/, // vim command
    /nano\s+/, // nano command
    /emacs\s+/, // emacs command
    /code\s+/, // code command (VS Code)

    // File copying and moving
    /cp\s+/, // cp command
    /mv\s+/, // mv command
    /scp\s+/, // scp command
    /rsync\s+/, // rsync command
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
 * TODO: Add tests for this class
 */
export class CommandValidator {
    private config: ProcessConfig;
    private logger: Logger;

    constructor(config: ProcessConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
        this.logger.debug(
            `CommandValidator initialized with security level: ${config.securityLevel}`
        );
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

        // 2. Check for shell backgrounding (trailing &)
        // This bypasses timeout and creates orphaned processes that can't be controlled
        if (/&\s*$/.test(trimmedCommand)) {
            return {
                isValid: false,
                error: 'Commands ending with & (shell backgrounding) are not allowed. Use run_in_background parameter instead for proper process management.',
            };
        }

        // 3. Check command length
        if (trimmedCommand.length > MAX_COMMAND_LENGTH) {
            return {
                isValid: false,
                error: `Command too long: ${trimmedCommand.length} characters. Maximum: ${MAX_COMMAND_LENGTH}`,
            };
        }

        // 4. Check against dangerous patterns (strict and moderate)
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

        // 5. Check for command injection attempts (all security levels)
        const injectionResult = this.detectInjection(trimmedCommand);
        if (!injectionResult.isValid) {
            return injectionResult;
        }

        // 6. Check against blocked commands list
        for (const blockedPattern of this.config.blockedCommands) {
            if (trimmedCommand.includes(blockedPattern)) {
                return {
                    isValid: false,
                    error: `Command is blocked: matches "${blockedPattern}"`,
                };
            }
        }

        // 7. Check against allowed commands list (if not empty)
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

        // 8. Determine if approval is required based on security level
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
                const isSafe = SAFE_PATTERNS.some((pattern) => pattern.test(command));
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
     * Handles compound commands (with &&, ||, ;) by checking each sub-command
     */
    private determineApprovalRequirement(command: string): boolean {
        // Split compound commands by &&, ||, or ; to check each part independently
        // This ensures dangerous operations in the middle of compound commands are detected
        const subCommands = command.split(/\s*(?:&&|\|\||;)\s*/).map((cmd) => cmd.trim());

        // Check if ANY sub-command requires approval
        for (const subCmd of subCommands) {
            if (!subCmd) continue; // Skip empty parts

            // Strip leading shell keywords and braces to get the actual command
            // This prevents bypassing approval checks via control-flow wrapping
            const normalizedSubCmd = subCmd
                .replace(/^(?:then|do|else)\b\s*/, '')
                .replace(/^\{\s*/, '')
                .trim();
            if (!normalizedSubCmd) continue;

            // Commands that modify system state always require approval
            for (const pattern of REQUIRES_APPROVAL_PATTERNS) {
                if (pattern.test(normalizedSubCmd)) {
                    return true;
                }
            }

            // In strict mode, all commands require approval
            if (this.config.securityLevel === 'strict') {
                return true;
            }

            // In moderate mode, write operations require approval
            if (this.config.securityLevel === 'moderate') {
                if (WRITE_PATTERNS.some((pattern) => pattern.test(normalizedSubCmd))) {
                    return true;
                }
            }
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
