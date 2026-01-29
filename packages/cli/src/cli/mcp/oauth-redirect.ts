export const DEFAULT_MCP_REDIRECT_URL = 'http://localhost:48910/callback';

export function getMcpRedirectUrl(): string {
    return process.env.DEXTO_MCP_REDIRECT_URL ?? DEFAULT_MCP_REDIRECT_URL;
}
