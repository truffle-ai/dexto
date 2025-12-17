/**
 * Input management service
 * Handles input detection and manipulation
 */

import {
    detectAutocompleteType,
    extractSlashQuery,
    extractResourceQuery,
    parseInput,
} from '../utils/inputParsing.js';
import type { AutocompleteType } from '../utils/inputParsing.js';
import type { CommandResult } from '../../commands/interactive-commands/command-parser.js';

/**
 * Service for managing input
 */
export class InputService {
    /**
     * Detects what type of autocomplete should be shown
     */
    detectAutocompleteType(input: string): AutocompleteType {
        return detectAutocompleteType(input);
    }

    /**
     * Extracts slash command query
     */
    extractSlashQuery(input: string): string {
        return extractSlashQuery(input);
    }

    /**
     * Extracts resource mention query
     */
    extractResourceQuery(input: string): string {
        return extractResourceQuery(input);
    }

    /**
     * Parses input
     */
    parseInput(input: string): CommandResult {
        return parseInput(input);
    }

    /**
     * Deletes word backward from cursor position
     */
    deleteWordBackward(text: string, cursorPos: number = text.length): string {
        if (cursorPos === 0) return text;

        let pos = cursorPos - 1;

        // Skip whitespace
        while (pos >= 0) {
            const char = text[pos];
            if (char && !/\s/.test(char)) break;
            pos--;
        }

        // Skip word characters
        while (pos >= 0) {
            const char = text[pos];
            if (char && /\s/.test(char)) break;
            pos--;
        }

        const deleteStart = pos + 1;
        return text.slice(0, deleteStart) + text.slice(cursorPos);
    }

    /**
     * Deletes word forward from cursor position
     */
    deleteWordForward(text: string, cursorPos: number = text.length): string {
        if (cursorPos >= text.length) return text;

        let pos = cursorPos;

        // Skip whitespace
        while (pos < text.length) {
            const char = text[pos];
            if (char && !/\s/.test(char)) break;
            pos++;
        }

        // Skip word characters
        while (pos < text.length) {
            const char = text[pos];
            if (char && /\s/.test(char)) break;
            pos++;
        }

        return text.slice(0, cursorPos) + text.slice(pos);
    }

    /**
     * Deletes entire line (for single-line input)
     */
    deleteLine(_text: string): string {
        return '';
    }
}
