/**
 * InputContainer Component
 * Smart container for input area - handles submission and state
 *
 * Buffer is passed as prop from parent (useCLIState).
 * No more ref chain - buffer can be accessed directly.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import type { DextoAgent, ContentPart, ImagePart, TextPart, QueuedMessage } from '@dexto/core';
import { InputArea, type OverlayTrigger } from '../components/input/InputArea.js';
import { InputService, processStream } from '../services/index.js';
import type {
    Message,
    UIState,
    InputState,
    SessionState,
    PendingImage,
    PastedBlock,
} from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';

/** Type for pending session creation promise */
type SessionCreationResult = { id: string };

interface InputContainerProps {
    /** Text buffer (owned by useCLIState) */
    buffer: TextBuffer;
    input: InputState;
    ui: UIState;
    session: SessionState;
    approval: ApprovalRequest | null;
    /** Queued messages waiting to be processed */
    queuedMessages: QueuedMessage[];
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    /** Setter for finalized messages (rendered in <Static>) */
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Setter for pending/streaming messages (rendered dynamically) */
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    agent: DextoAgent;
    inputService: InputService;
    /** Optional keyboard scroll handler (for alternate buffer mode) */
    onKeyboardScroll?: (direction: 'up' | 'down') => void;
}

/**
 * Smart container for input area
 * Manages submission, history, and overlay triggers
 */
export function InputContainer({
    buffer,
    input,
    ui,
    session,
    approval,
    queuedMessages,
    setInput,
    setUi,
    setSession,
    setMessages,
    setPendingMessages,
    agent,
    inputService,
    onKeyboardScroll,
}: InputContainerProps) {
    // Track pending session creation to prevent race conditions
    const sessionCreationPromiseRef = useRef<Promise<SessionCreationResult> | null>(null);

    // Clear the session creation ref when session is cleared
    useEffect(() => {
        if (session.id === null) {
            sessionCreationPromiseRef.current = null;
        }
    }, [session.id]);

    // Extract text content from ContentPart[]
    const extractTextFromContent = useCallback((content: ContentPart[]): string => {
        return content
            .filter((part): part is TextPart => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    }, []);

    // Handle history navigation - set text directly on buffer
    // Up arrow first edits queued messages (removes from queue), then navigates history
    const handleHistoryNavigate = useCallback(
        (direction: 'up' | 'down') => {
            const { history, historyIndex, draftBeforeHistory } = input;

            if (direction === 'up') {
                // First check if there are queued messages to edit
                if (queuedMessages.length > 0 && session.id) {
                    // Get the last queued message
                    const lastQueued = queuedMessages[queuedMessages.length - 1];
                    if (lastQueued) {
                        // Extract text content and put it in the input
                        const text = extractTextFromContent(lastQueued.content);
                        buffer.setText(text);
                        setInput((prev) => ({ ...prev, value: text }));
                        // Remove from queue (this will trigger the event and update queuedMessages state)
                        agent.removeQueuedMessage(session.id, lastQueued.id).catch(() => {
                            // Silently ignore errors - queue might have been cleared
                        });
                        return;
                    }
                }

                // Don't navigate history when processing (only queue editing is allowed)
                if (ui.isProcessing) return;

                // No queued messages, navigate history
                if (history.length === 0) return;

                let newIndex = historyIndex;
                if (newIndex < 0) {
                    // First time pressing up - save current input as draft
                    const currentText = buffer.text;
                    setInput((prev) => ({
                        ...prev,
                        draftBeforeHistory: currentText,
                        historyIndex: history.length - 1,
                        value: history[history.length - 1] || '',
                    }));
                    buffer.setText(history[history.length - 1] || '');
                    return;
                } else if (newIndex > 0) {
                    newIndex = newIndex - 1;
                } else {
                    return; // Already at oldest
                }

                const historyItem = history[newIndex] || '';
                buffer.setText(historyItem);
                setInput((prev) => ({ ...prev, value: historyItem, historyIndex: newIndex }));
            } else {
                // Down - navigate history (queued messages don't affect down navigation)
                // Don't navigate history when processing
                if (ui.isProcessing) return;
                if (historyIndex < 0) return; // Not navigating history
                if (historyIndex < history.length - 1) {
                    const newIndex = historyIndex + 1;
                    const historyItem = history[newIndex] || '';
                    buffer.setText(historyItem);
                    setInput((prev) => ({ ...prev, value: historyItem, historyIndex: newIndex }));
                } else {
                    // At newest history item, restore draft
                    buffer.setText(draftBeforeHistory);
                    setInput((prev) => ({
                        ...prev,
                        value: draftBeforeHistory,
                        historyIndex: -1,
                        draftBeforeHistory: '',
                    }));
                }
            }
        },
        [
            buffer,
            input,
            setInput,
            queuedMessages,
            session.id,
            agent,
            extractTextFromContent,
            ui.isProcessing,
        ]
    );

    // Handle overlay triggers
    const handleTriggerOverlay = useCallback(
        (trigger: OverlayTrigger) => {
            if (ui.isProcessing || approval) return;

            if (trigger === 'close') {
                if (
                    ui.activeOverlay === 'slash-autocomplete' ||
                    ui.activeOverlay === 'resource-autocomplete'
                ) {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'none',
                        mcpWizardServerType: null,
                    }));
                }
            } else if (trigger === 'slash-autocomplete') {
                setUi((prev) => ({ ...prev, activeOverlay: 'slash-autocomplete' }));
            } else if (trigger === 'resource-autocomplete') {
                setUi((prev) => ({ ...prev, activeOverlay: 'resource-autocomplete' }));
            }
        },
        [setUi, ui.isProcessing, ui.activeOverlay, approval]
    );

    // Handle image paste from clipboard
    const handleImagePaste = useCallback(
        (image: PendingImage) => {
            setInput((prev) => ({
                ...prev,
                images: [...prev.images, image],
            }));
        },
        [setInput]
    );

    // Handle image removal (when placeholder is deleted from text)
    const handleImageRemove = useCallback(
        (imageId: string) => {
            setInput((prev) => ({
                ...prev,
                images: prev.images.filter((img) => img.id !== imageId),
            }));
        },
        [setInput]
    );

    // Handle new paste block creation (when large text is pasted)
    const handlePasteBlock = useCallback(
        (block: PastedBlock) => {
            setInput((prev) => ({
                ...prev,
                pastedBlocks: [...prev.pastedBlocks, block],
                pasteCounter: Math.max(prev.pasteCounter, block.number),
            }));
        },
        [setInput]
    );

    // Handle paste block update (e.g., toggle collapse)
    const handlePasteBlockUpdate = useCallback(
        (blockId: string, updates: Partial<PastedBlock>) => {
            setInput((prev) => ({
                ...prev,
                pastedBlocks: prev.pastedBlocks.map((block) =>
                    block.id === blockId ? { ...block, ...updates } : block
                ),
            }));
        },
        [setInput]
    );

    // Handle paste block removal (when placeholder is deleted from text)
    const handlePasteBlockRemove = useCallback(
        (blockId: string) => {
            setInput((prev) => ({
                ...prev,
                pastedBlocks: prev.pastedBlocks.filter((block) => block.id !== blockId),
            }));
        },
        [setInput]
    );

    // Expand all collapsed paste blocks in a text string
    const expandPasteBlocks = useCallback((text: string, blocks: PastedBlock[]): string => {
        let result = text;
        // Sort blocks by placeholder position descending to avoid offset issues
        const sortedBlocks = [...blocks].sort((a, b) => {
            const posA = result.indexOf(a.placeholder);
            const posB = result.indexOf(b.placeholder);
            return posB - posA;
        });

        for (const block of sortedBlocks) {
            if (block.isCollapsed) {
                // Replace placeholder with full text
                result = result.replace(block.placeholder, block.fullText);
            }
        }
        return result;
    }, []);

    // Handle submission
    const handleSubmit = useCallback(
        async (value: string) => {
            // Expand all collapsed paste blocks before processing
            const expandedValue = expandPasteBlocks(value, input.pastedBlocks);
            const trimmed = expandedValue.trim();
            if (!trimmed) return;

            // Auto-queue when agent is processing
            if (ui.isProcessing && session.id) {
                // Build content parts for queueing
                const content: ContentPart[] = [{ type: 'text', text: trimmed } as TextPart];
                // Add images if any
                for (const img of input.images) {
                    content.push({
                        type: 'image',
                        image: img.data,
                        mimeType: img.mimeType,
                    } as ImagePart);
                }

                try {
                    await agent.queueMessage(session.id, { content });
                    // Queued messages are displayed via QueuedMessagesDisplay component
                    // (state updated by message:queued event handler in useAgentEvents)

                    // Clear input and images
                    buffer.setText('');
                    setInput((prev) => ({
                        ...prev,
                        value: '',
                        images: [],
                        pastedBlocks: [],
                    }));
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
                return;
            }

            // Prevent double submission when autocomplete/selector is active
            if (ui.activeOverlay !== 'none' && ui.activeOverlay !== 'approval') {
                return;
            }

            // Capture images before clearing - we need them for the API call
            const pendingImages = [...input.images];

            // Create user message and add it to messages
            const userMessage = createUserMessage(trimmed);
            setMessages((prev) => [...prev, userMessage]);

            // Clear input directly on buffer and update history
            buffer.setText('');
            setInput((prev) => {
                const newHistory =
                    prev.history.length > 0 && prev.history[prev.history.length - 1] === trimmed
                        ? prev.history
                        : [...prev.history, trimmed].slice(-100);
                return {
                    value: '',
                    history: newHistory,
                    historyIndex: -1,
                    draftBeforeHistory: '',
                    images: [], // Clear images on submit
                    pastedBlocks: [], // Clear paste blocks on submit
                    pasteCounter: prev.pasteCounter, // Keep counter for next session
                };
            });

            // Start processing
            setUi((prev) => ({
                ...prev,
                isProcessing: true,
                isCancelling: false,
                activeOverlay: 'none',
                exitWarningShown: false,
                exitWarningTimestamp: null,
            }));

            // Parse and handle command or prompt
            const parsed = inputService.parseInput(trimmed);

            // Check if this is a command that should show an interactive selector
            if (parsed.type === 'command' && parsed.command) {
                const command = parsed.command;
                const hasArgs = parsed.args && parsed.args.length > 0;

                if (command === 'mcp' && !hasArgs) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'mcp-selector',
                    }));
                    return;
                }

                if (command === 'mcp' && parsed.args?.[0] === 'add' && parsed.args.length === 1) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'mcp-add-selector',
                    }));
                    return;
                }

                if (
                    command === 'mcp' &&
                    parsed.args?.[0] === 'remove' &&
                    parsed.args.length === 1
                ) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'mcp-remove-selector',
                    }));
                    return;
                }

                if (command === 'log' && !hasArgs) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'log-level-selector',
                    }));
                    return;
                }

                if (command === 'session' && !hasArgs) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'session-subcommand-selector',
                    }));
                    return;
                }
            }

            if (parsed.type === 'command' && parsed.command) {
                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    const result = await commandService.executeCommand(
                        parsed.command,
                        parsed.args || [],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'prompt') {
                        return;
                    }

                    if (result.type === 'output' && result.output) {
                        const output = result.output;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: output,
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    if (result.type === 'styled' && result.styled) {
                        const { fallbackText, styledType, styledData } = result.styled;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: fallbackText,
                                timestamp: new Date(),
                                styledType,
                                styledData,
                            },
                        ]);
                    }

                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                }
            } else {
                try {
                    let currentSessionId = session.id;

                    if (!currentSessionId) {
                        if (sessionCreationPromiseRef.current) {
                            try {
                                const existingSession = await sessionCreationPromiseRef.current;
                                currentSessionId = existingSession.id;
                            } catch {
                                sessionCreationPromiseRef.current = null;
                            }
                        }

                        if (!currentSessionId) {
                            const sessionPromise = agent.createSession();
                            sessionCreationPromiseRef.current = sessionPromise;

                            const newSession = await sessionPromise;
                            currentSessionId = newSession.id;
                            setSession((prev) => ({
                                ...prev,
                                id: currentSessionId,
                                hasActiveSession: true,
                            }));
                        }
                    }

                    if (!currentSessionId) {
                        throw new Error('Failed to create or retrieve session');
                    }

                    const metadata = await agent.getSessionMetadata(currentSessionId);
                    const isFirstMessage = !metadata || metadata.messageCount <= 0;

                    // Build content with images if any
                    let content: string | ContentPart[];
                    if (pendingImages.length > 0) {
                        // Build multimodal content parts
                        const parts: ContentPart[] = [];

                        // Add text part first
                        parts.push({ type: 'text', text: trimmed } as TextPart);

                        // Add image parts
                        for (const img of pendingImages) {
                            parts.push({
                                type: 'image',
                                image: img.data,
                                mimeType: img.mimeType,
                            } as ImagePart);
                        }

                        content = parts;
                    } else {
                        content = trimmed;
                    }

                    // Use streaming API and process events directly
                    const iterator = await agent.stream(content, currentSessionId);
                    await processStream(iterator, { setMessages, setPendingMessages, setUi });

                    if (isFirstMessage) {
                        agent.generateSessionTitle(currentSessionId).catch((error) => {
                            console.error('Failed to generate session title:', error);
                        });
                    }
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                }
            }
        },
        [
            buffer,
            input.images,
            input.pastedBlocks,
            expandPasteBlocks,
            setInput,
            setUi,
            setMessages,
            setPendingMessages,
            setSession,
            agent,
            inputService,
            ui.isProcessing,
            ui.activeOverlay,
            session.id,
        ]
    );

    // Determine if input should be active (not blocked by approval/overlay)
    // Input stays active even with overlays (so user can keep typing to filter)
    // Only disable for approval prompts
    const isInputActive = !approval;
    const isInputDisabled = !!approval;
    const shouldHandleSubmit = ui.activeOverlay === 'none' || ui.activeOverlay === 'approval';
    // Allow history navigation when not blocked by approval/overlay
    // When processing: handler allows queue editing but blocks history navigation
    const canNavigateHistory = !approval && ui.activeOverlay === 'none';

    const placeholder = approval
        ? 'Approval required above...'
        : 'Type your message or /help for commands';

    return (
        <InputArea
            buffer={buffer}
            onSubmit={shouldHandleSubmit ? handleSubmit : () => {}}
            isDisabled={isInputDisabled}
            isActive={isInputActive}
            placeholder={placeholder}
            onHistoryNavigate={canNavigateHistory ? handleHistoryNavigate : undefined}
            onTriggerOverlay={handleTriggerOverlay}
            onKeyboardScroll={onKeyboardScroll}
            imageCount={input.images.length}
            onImagePaste={handleImagePaste}
            images={input.images}
            onImageRemove={handleImageRemove}
            pastedBlocks={input.pastedBlocks}
            onPasteBlock={handlePasteBlock}
            onPasteBlockUpdate={handlePasteBlockUpdate}
            onPasteBlockRemove={handlePasteBlockRemove}
        />
    );
}
