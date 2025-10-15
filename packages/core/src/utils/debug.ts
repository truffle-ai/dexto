export function shouldIncludeRawToolResult(): boolean {
    const flag = process.env.DECTO_DEBUG_TOOL_RESULT_RAW;
    if (!flag) return false;
    switch (flag.trim().toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'on':
            return true;
        default:
            return false;
    }
}
