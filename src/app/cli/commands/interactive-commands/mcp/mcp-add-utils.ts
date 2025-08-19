import {
    StdioServerConfig,
    HttpServerConfig,
    SseServerConfig,
    McpServerConfig,
} from '@core/mcp/schemas.js';
import { resolveAndValidateMcpServerConfig } from '@core/mcp/resolver.js';
import { parseOptions } from '../utils/arg-parser.js';
import chalk from 'chalk';

/**
 * Parse stdio server arguments
 */
export function parseStdioArgs(args: string[]): {
    serverName: string;
    config: StdioServerConfig;
    errors: string[];
} {
    const errors: string[] = [];

    if (args.length < 2) {
        errors.push('Usage: /mcp add stdio <name> <command> [args...] [options]');
        return { serverName: '', config: {} as StdioServerConfig, errors };
    }

    const { parsedArgs, options } = parseOptions(args);
    const [serverName, command, ...commandArgs] = parsedArgs;

    if (!serverName) {
        errors.push('Server name is required');
    }
    if (!command) {
        errors.push('Command is required for stdio servers');
    }

    const config: StdioServerConfig = {
        type: 'stdio',
        command: command || '',
        args: commandArgs,
        env: {},
        timeout: parseInt(options.timeout || '30000', 10),
        connectionMode:
            options.mode === 'strict' || options.mode === 'lenient' ? options.mode : 'lenient',
    };

    // Parse env options
    Object.keys(options).forEach((key) => {
        if (key.startsWith('env-')) {
            const envKey = key.slice(4);
            if (!config.env) config.env = {};
            config.env[envKey] = options[key]!;
        }
    });

    return { serverName: serverName || '', config, errors };
}

/**
 * Parse HTTP server arguments
 */
export function parseHttpArgs(args: string[]): {
    serverName: string;
    config: HttpServerConfig;
    errors: string[];
} {
    const errors: string[] = [];

    if (args.length < 2) {
        errors.push('Usage: /mcp add http <name> <url> [options]');
        return { serverName: '', config: {} as HttpServerConfig, errors };
    }

    const { parsedArgs, options } = parseOptions(args);
    const [serverName, url] = parsedArgs;

    if (!serverName) {
        errors.push('Server name is required');
    }
    if (!url) {
        errors.push('URL is required for HTTP servers');
    }

    // Validate URL format
    if (url) {
        try {
            new URL(url);
        } catch {
            errors.push(`Invalid URL format: ${url}`);
        }
    }

    const headers: Record<string, string> = {};
    Object.keys(options).forEach((key) => {
        if (key.startsWith('header-')) {
            const headerKey = key.slice(7);
            headers[headerKey] = options[key]!;
        }
    });

    const config: HttpServerConfig = {
        type: 'http',
        url: url || '',
        headers,
        timeout: parseInt(options.timeout || '30000', 10),
        connectionMode:
            options.mode === 'strict' || options.mode === 'lenient' ? options.mode : 'lenient',
    };

    return { serverName: serverName || '', config, errors };
}

/**
 * Parse SSE server arguments
 */
export function parseSseArgs(args: string[]): {
    serverName: string;
    config: SseServerConfig;
    errors: string[];
} {
    const errors: string[] = [];

    if (args.length < 2) {
        errors.push('Usage: /mcp add sse <name> <url> [options]');
        return { serverName: '', config: {} as SseServerConfig, errors };
    }

    const { parsedArgs, options } = parseOptions(args);
    const [serverName, url] = parsedArgs;

    if (!serverName) {
        errors.push('Server name is required');
    }
    if (!url) {
        errors.push('URL is required for SSE servers');
    }

    // Validate URL format
    if (url) {
        try {
            new URL(url);
        } catch {
            errors.push(`Invalid URL format: ${url}`);
        }
    }

    const headers: Record<string, string> = {};
    Object.keys(options).forEach((key) => {
        if (key.startsWith('header-')) {
            const headerKey = key.slice(7);
            headers[headerKey] = options[key]!;
        }
    });

    const config: SseServerConfig = {
        type: 'sse',
        url: url || '',
        headers,
        timeout: parseInt(options.timeout || '30000', 10),
        connectionMode:
            options.mode === 'strict' || options.mode === 'lenient' ? options.mode : 'lenient',
    };

    return { serverName: serverName || '', config, errors };
}

// TODO: Add MCP server presets system for common configurations.
// Will add an MCP registry into core and use that

/**
 * Show help for MCP add commands
 */
export function showMcpAddHelp(): void {
    console.log(chalk.bold.blue('\n🔧 MCP Add Commands:\n'));

    console.log(chalk.yellow('STDIO Servers (most common):'));
    console.log(chalk.dim('  /mcp add stdio <name> <command> [args...] [options]'));
    console.log(chalk.dim('  Examples:'));
    console.log(chalk.dim('    /mcp add stdio music uvx truffle-ai-music-creator-mcp'));
    console.log(
        chalk.dim('    /mcp add stdio filesystem npx -y @modelcontextprotocol/server-filesystem .')
    );
    console.log(
        chalk.dim('    /mcp add stdio sqlite npx -y @executeautomation/database-server example.db')
    );

    console.log(chalk.yellow('\nHTTP Servers:'));
    console.log(chalk.dim('  /mcp add http <name> <url> [options]'));
    console.log(chalk.dim('  Examples:'));
    console.log(chalk.dim('    /mcp add http remote http://localhost:8080'));
    console.log(
        chalk.dim(
            '    /mcp add http notion https://api.notion.com --header-Authorization="Bearer token"'
        )
    );

    console.log(chalk.yellow('\nSSE Servers:'));
    console.log(chalk.dim('  /mcp add sse <name> <url> [options]'));
    console.log(chalk.dim('  Examples:'));
    console.log(chalk.dim('    /mcp add sse events http://localhost:9000/events'));

    // TODO: Add preset commands here when implemented

    console.log(chalk.yellow('\nOptions (for all types):'));
    console.log(chalk.dim('  --timeout=<ms>     Connection timeout (default: 30000)'));
    console.log(chalk.dim('  --mode=<strict|lenient>  Connection mode (default: lenient)'));
    console.log(chalk.dim('  --env-<key>=<value>    Environment variables (stdio only)'));
    console.log(chalk.dim('  --header-<key>=<value> HTTP/SSE headers\n'));
}

/**
 * Validate server configuration and show errors
 */
export function validateAndShowErrors(
    serverName: string,
    config: McpServerConfig,
    existingServers: string[] = []
): boolean {
    const result = resolveAndValidateMcpServerConfig(serverName, config, existingServers);

    if (!result.ok) {
        console.log(chalk.red('❌ Server configuration validation failed:'));
        const errors = result.issues.filter((issue) => issue.severity === 'error');
        for (const error of errors) {
            console.log(chalk.red(`   ${error.message}`));
            if (
                error.context &&
                typeof error.context === 'object' &&
                'suggestedAction' in error.context
            ) {
                console.log(chalk.dim(`   💡 ${error.context.suggestedAction}`));
            }
        }
        return false;
    }

    const warnings = result.issues.filter((issue) => issue.severity === 'warning');
    if (warnings.length > 0) {
        for (const warning of warnings) {
            console.log(chalk.yellow(`⚠️  ${warning.message}`));
        }
    }

    return true;
}
