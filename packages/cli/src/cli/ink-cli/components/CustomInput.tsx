import { useInput, Text } from 'ink';

interface CustomInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    placeholder?: string;
    isProcessing?: boolean;
    onWordDelete?: () => void;
    onLineDelete?: () => void;
    onToggleMultiLine?: () => void;
}

/**
 * Custom input component that handles keyboard shortcuts
 * Fully custom implementation without TextInput to properly handle shortcuts
 */
export default function CustomInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    isProcessing = false,
    onWordDelete,
    onLineDelete,
    onToggleMultiLine,
}: CustomInputProps) {
    // Handle all keyboard input directly
    useInput(
        (inputChar, key) => {
            if (isProcessing) return;

            // Shift+Enter = toggle multi-line mode
            if (key.return && key.shift) {
                onToggleMultiLine?.();
                return;
            }

            // Enter = submit
            if (key.return) {
                onSubmit(value);
                return;
            }

            // Ctrl+U = line delete (Unix standard, also what Cmd+Backspace becomes)
            if (key.ctrl && inputChar === 'u') {
                onLineDelete?.();
                return;
            }

            // Ctrl+W = word delete (Unix standard, also what Option+Backspace becomes)
            if (key.ctrl && inputChar === 'w') {
                onWordDelete?.();
                return;
            }

            // Regular backspace/delete
            if (key.backspace || key.delete) {
                onChange(value.slice(0, -1));
                return;
            }

            // Regular character input
            if (inputChar && !key.ctrl && !key.meta) {
                onChange(value + inputChar);
            }
        },
        { isActive: true }
    );

    // Render with block cursor highlighting the character at cursor position
    if (!value && placeholder) {
        // Empty input - highlight first character of placeholder
        const firstChar = placeholder[0] || ' ';
        const rest = placeholder.slice(1);
        return (
            <Text>
                <Text color="black" backgroundColor="green">
                    {firstChar}
                </Text>
                <Text color="gray">{rest}</Text>
            </Text>
        );
    }

    // Has value - highlight character after end (space)
    return (
        <Text>
            {value}
            <Text color="black" backgroundColor="green">
                {' '}
            </Text>
        </Text>
    );
}
