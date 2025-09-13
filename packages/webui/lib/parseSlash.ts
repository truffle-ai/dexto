export type SlashParse = {
    isSlash: boolean;
    command: string;
    argsArray: string[];
    argsText: string;
};

function parseQuotedArguments(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let i = 0;

    while (i < input.length) {
        const char = input[i];
        const nextChar = input[i + 1];

        if (!inQuotes && (char === '"' || char === "'")) {
            inQuotes = true;
            quoteChar = char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            quoteChar = '';
        } else if (!inQuotes && char === ' ') {
            if (current) {
                args.push(current);
                current = '';
            }
        } else if (char === '\\' && nextChar) {
            current += nextChar;
            i++;
        } else {
            current += char;
        }
        i++;
    }

    if (current) args.push(current);
    return args.filter(Boolean);
}

export function parseSlashInput(input: string): SlashParse {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/'))
        return { isSlash: false, command: '', argsArray: [], argsText: '' };
    const parts = parseQuotedArguments(trimmed.slice(1));
    const command = parts[0] || '';
    const argsArray = parts.slice(1);
    const argsText = argsArray.join(' ');
    return { isSlash: true, command, argsArray, argsText };
}
