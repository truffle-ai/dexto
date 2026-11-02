/**
 * Splits an error message's text into what the Signal FAULT block shows. Errors reach the
 * transcript as one string: "Error: what happened", then any detail, then "💡 what to try".
 */
export interface FaultBlock {
    title: string;
    /** Further lines of the error. */
    body: string[];
    /** Recovery steps. */
    next: string[];
}

const RECOVERY = /^💡\s*/u;

export function faultBlock(content: string): FaultBlock {
    const lines = content
        .replace(/^Error:\s*/, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const rest = lines.slice(1);
    return {
        title: lines[0] ?? 'Something went wrong',
        body: rest.filter((line) => !RECOVERY.test(line)),
        next: rest.filter((line) => RECOVERY.test(line)).map((line) => line.replace(RECOVERY, '')),
    };
}
