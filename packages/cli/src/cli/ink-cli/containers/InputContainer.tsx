/**
 * InputContainer Component
 * Smart container for input area - handles submission and state
 *
 * Buffer is passed as prop from parent (useCLIState).
 * No more ref chain - buffer can be accessed directly.
 */

import React, { useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { DextoAgent, ContentPart, ImagePart, TextPart, QueuedMessage } from '@dexto/core';
import { InputArea, type OverlayTrigger } from '../components/input/InputArea.js';
import { InputService, processStream } from '../services/index.js';
import { useSoundService } from '../contexts/index.js';
import type {
    Message,
    UIState,
    InputState,
    SessionState,
    PendingImage,
    PastedBlock,
    TodoItem,
} from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { capture } from '../../../analytics/index.js';
import { getOverlayPresentation } from '../utils/overlayPresentation.js';

/** Type for pending session creation promise */
type SessionCreationResult = { id: string };

/** Handle for imperative access to InputContainer */
export interface InputContainerHandle {
    /** Submit a command/message programmatically (bypasses overlay check) */
    submit: (text: string) => Promise<void>;
}

interface InputContainerProps {
    /** Text buffer (owned by useCLIState) */
    buffer: TextBuffer;
    input: InputState;
    ui: UIState;
    session: SessionState;
    /** If provided, auto-submits once when the UI is ready */
    initialPrompt?: string | undefined;
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
    /** Setter for dequeued buffer (user messages waiting to render after pending) */
    setDequeuedBuffer: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Setter for queued messages */
    setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
    /** Setter for current approval request (for approval UI via processStream) */
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    /** Setter for approval queue (for queued approvals via processStream) */
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
    /** Setter for todo items (for todo tool updates via processStream) */
    setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>;
    agent: DextoAgent;
    inputService: InputService;
    /** Source agent config file path (if available) */
    configFilePath: string | null;
    /** Optional keyboard scroll handler (for alternate buffer mode) */
    onKeyboardScroll?: (direction: 'up' | 'down') => void;
    /** Whether to stream chunks or wait for complete response (default: true) */
    useStreaming?: boolean;
}

/**
 * Smart container for input area
 * Manages submission, history, and overlay triggers
 */
export const InputContainer = forwardRef<InputContainerHandle, InputContainerProps>(
    function InputContainer(
        {
            buffer,
            input,
            ui,
            session,
            initialPrompt,
            approval,
            queuedMessages,
            setInput,
            setUi,
            setSession,
            setMessages,
            setPendingMessages,
            setDequeuedBuffer,
            setQueuedMessages,
            setApproval,
            setApprovalQueue,
            setTodos,
            agent,
            inputService,
            configFilePath,
            onKeyboardScroll,
            useStreaming = true,
        },
        ref
    ) {
        // Track pending session creation to prevent race conditions
        const sessionCreationPromiseRef = useRef<Promise<SessionCreationResult> | null>(null);

        const didAutoSubmitInitialPromptRef = useRef(false);

        // Sound notification service from context
        const soundService = useSoundService();

        // Ref to track autoApproveEdits so processStream can read latest value mid-stream
        const autoApproveEditsRef = useRef(ui.autoApproveEdits);
        useEffect(() => {
            autoApproveEditsRef.current = ui.autoApproveEdits;
        }, [ui.autoApproveEdits]);

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
                        setInput((prev) => ({
                            ...prev,
                            value: historyItem,
                            historyIndex: newIndex,
                        }));
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
        // Allow triggers while processing (for queuing), but not during approval
        // IMPORTANT: Use functional updates to check prev.activeOverlay, not the closure value.
        // This avoids race conditions when open/close happen in quick succession (React batching).
        const handleTriggerOverlay = useCallback(
            (trigger: OverlayTrigger) => {
                if (approval) return;

                if (trigger === 'close') {
                    // Use functional update to check the ACTUAL current state, not stale closure
                    setUi((prev) => {
                        if (
                            prev.activeOverlay === 'slash-autocomplete' ||
                            prev.activeOverlay === 'resource-autocomplete'
                        ) {
                            return {
                                ...prev,
                                activeOverlay: 'none',
                                mcpWizardServerType: null,
                            };
                        }
                        return prev;
                    });
                } else if (trigger === 'slash-autocomplete') {
                    setUi((prev) => ({ ...prev, activeOverlay: 'slash-autocomplete' }));
                } else if (trigger === 'resource-autocomplete') {
                    setUi((prev) => ({ ...prev, activeOverlay: 'resource-autocomplete' }));
                }
            },
            [setUi, approval]
        );

        // Handle image paste from clipboard
        const handleImagePaste = useCallback(
            (image: PendingImage) => {
                // Track image attachment analytics (only if session exists)
                if (session.id) {
                    capture('dexto_image_attached', {
                        source: 'cli',
                        sessionId: session.id,
                        imageType: image.mimeType,
                        imageSizeBytes: Math.floor(image.data.length * 0.75), // Approx base64 decode
                    });
                }

                setInput((prev) => ({
                    ...prev,
                    images: [...prev.images, image],
                }));
            },
            [setInput, session.id]
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
        // bypassOverlayCheck: skip the overlay check when called programmatically (e.g., from OverlayContainer)
        const handleSubmit = useCallback(
            async (value: string, bypassOverlayCheck = false) => {
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

                        // Clear input, update history, and clear images
                        buffer.setText('');
                        setInput((prev) => {
                            const newHistory =
                                prev.history.length > 0 &&
                                prev.history[prev.history.length - 1] === trimmed
                                    ? prev.history
                                    : [...prev.history, trimmed].slice(-100);
                            return {
                                ...prev,
                                value: '',
                                history: newHistory,
                                historyIndex: -1,
                                draftBeforeHistory: '',
                                images: [],
                                pastedBlocks: [],
                            };
                        });
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
                // Skip this check when called programmatically (e.g., from OverlayContainer prompt selection)
                if (
                    !bypassOverlayCheck &&
                    ui.activeOverlay !== 'none' &&
                    ui.activeOverlay !== 'approval'
                ) {
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
                    commandOutput: null,
                    exitWarningShown: false,
                    exitWarningTimestamp: null,
                }));

                // Parse and handle command or prompt
                const parsed = inputService.parseInput(trimmed);

                // Check if this command should show an interactive overlay
                if (parsed.type === 'command' && parsed.command) {
                    const { getCommandOverlay } = await import('../utils/commandOverlays.js');
                    const overlay = getCommandOverlay(parsed.command, parsed.args || []);
                    if (overlay) {
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            activeOverlay: overlay,
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
                            session.id || undefined,
                            configFilePath
                        );

                        if (result.type === 'output' && result.output) {
                            const output = result.output;
                            setUi((prev) => ({
                                ...prev,
                                activeOverlay: 'command-output',
                                commandOutput: {
                                    title: `/${parsed.command}`,
                                    content: output,
                                },
                            }));
                        }

                        if (result.type === 'styled' && result.styled) {
                            const { fallbackText } = result.styled;
                            setUi((prev) => ({
                                ...prev,
                                activeOverlay: 'command-output',
                                commandOutput: {
                                    title: `/${parsed.command}`,
                                    content: fallbackText,
                                },
                            }));
                        }

                        // Handle sendMessage - send through normal streaming flow
                        if (result.type === 'sendMessage' && result.messageToSend) {
                            let currentSessionId = session.id;

                            if (!currentSessionId) {
                                if (sessionCreationPromiseRef.current) {
                                    try {
                                        const existingSession =
                                            await sessionCreationPromiseRef.current;
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

                            // Send through normal streaming flow (matches WebUI pattern)
                            const iterator = await agent.stream(
                                result.messageToSend,
                                currentSessionId
                            );
                            await processStream(
                                iterator,
                                {
                                    setMessages,
                                    setPendingMessages,
                                    setDequeuedBuffer,
                                    setUi,
                                    setSession,
                                    setQueuedMessages,
                                    setApproval,
                                    setApprovalQueue,
                                },
                                {
                                    useStreaming,
                                    autoApproveEditsRef,
                                    eventBus: agent,
                                    setTodos,
                                    ...(soundService && { soundService }),
                                }
                            );
                            return; // processStream handles UI state
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
                                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
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

                        // Plan mode injection: prepend plan skill content on first message
                        // The <plan-mode> tags are filtered out by the message renderer so users
                        // don't see the instructions, but the LLM receives them.
                        //
                        // TODO: Consider dropping <plan-mode> content after plan is approved/disabled.
                        // Edge case: user may still need access to plan tools after approval for
                        // progress tracking (checking off tasks). Current approach keeps it simple
                        // by letting the content remain in context - it's not re-injected, just
                        // stays from the first message.
                        let messageText = trimmed;
                        if (ui.planModeActive && !ui.planModeInitialized) {
                            try {
                                const planSkill = await agent.resolvePrompt(
                                    'config:dexto-plan-mode',
                                    {}
                                );
                                if (planSkill.text) {
                                    messageText = `<plan-mode>\n${planSkill.text}\n</plan-mode>\n\n${trimmed}`;
                                    // Mark plan mode as initialized after injection
                                    setUi((prev) => ({ ...prev, planModeInitialized: true }));
                                }
                            } catch {
                                // Plan skill not found - continue without injection
                                // This can happen if the agent config/image doesn't include `config:dexto-plan-mode`.
                            }
                        }

                        if (pendingImages.length > 0) {
                            // Build multimodal content parts
                            const parts: ContentPart[] = [];

                            // Add text part first (with potential plan-mode injection)
                            parts.push({ type: 'text', text: messageText } as TextPart);

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
                            content = messageText;
                        }

                        // Get current LLM config for analytics
                        const llmConfig = agent.getCurrentLLMConfig();

                        // Track message sent analytics
                        capture('dexto_message_sent', {
                            source: 'cli',
                            sessionId: currentSessionId,
                            provider: llmConfig.provider,
                            model: llmConfig.model,
                            hasImage: pendingImages.length > 0,
                            hasFile: false,
                            messageLength: trimmed.length,
                        });

                        // Use streaming API and process events directly
                        const iterator = await agent.stream(content, currentSessionId);
                        await processStream(
                            iterator,
                            {
                                setMessages,
                                setPendingMessages,
                                setDequeuedBuffer,
                                setUi,
                                setSession,
                                setQueuedMessages,
                                setApproval,
                                setApprovalQueue,
                            },
                            {
                                useStreaming,
                                autoApproveEditsRef,
                                eventBus: agent,
                                setTodos,
                                ...(soundService && { soundService }),
                            }
                        );

                        if (isFirstMessage) {
                            agent.generateSessionTitle(currentSessionId).catch(() => {
                                // Title generation is non-critical - silently ignore failures
                            });
                        }
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
                setDequeuedBuffer,
                setQueuedMessages,
                setSession,
                agent,
                inputService,
                ui.isProcessing,
                ui.activeOverlay,
                ui.planModeActive,
                ui.planModeInitialized,
                session.id,
                useStreaming,
                soundService,
            ]
        );

        useEffect(() => {
            if (!initialPrompt || didAutoSubmitInitialPromptRef.current) {
                return;
            }

            didAutoSubmitInitialPromptRef.current = true;

            handleSubmit(initialPrompt, true).catch((error) => {
                agent.logger.error('InputContainer initial prompt submission failed', {
                    error,
                    initialPrompt,
                });
                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('error'),
                        role: 'system',
                        content: `Failed to submit initial prompt: ${error instanceof Error ? error.message : String(error)}`,
                        timestamp: new Date(),
                    },
                ]);
            });
        }, [agent.logger, handleSubmit, initialPrompt, setMessages]);

        // Determine if input should be active (not blocked by approval/overlay/history search)
        // Input stays active for filter-type overlays (so user can keep typing to filter)
        // Disable for approval prompts, overlays with their own text input, and history search mode
        const overlaysWithOwnInput = [
            'mcp-custom-wizard',
            'custom-model-wizard',
            'api-key-input',
            'search',
            'tool-browser',
            'prompt-add-wizard',
            'model-selector',
            'export-wizard',
            'marketplace-add',
        ];
        const hasOverlayWithOwnInput = overlaysWithOwnInput.includes(ui.activeOverlay);
        const isHistorySearchActive = ui.historySearch.isActive;
        const isInputActive = !approval && !hasOverlayWithOwnInput && !isHistorySearchActive;
        const isInputDisabled = !!approval || hasOverlayWithOwnInput || isHistorySearchActive;
        // Allow submit when:
        // - no overlay active
        // - approval active
        // Note: slash-autocomplete handles its own Enter key (either executes command or submits raw text)
        const shouldHandleSubmit = ui.activeOverlay === 'none' || ui.activeOverlay === 'approval';
        // Allow history navigation when not blocked by approval/overlay
        // Allow during processing so users can browse previous prompts while agent runs
        const canNavigateHistory = !approval && ui.activeOverlay === 'none';

        // Hide the input area when a focused overlay/approval is active.
        // This matches "full-screen overlay" UX (Claude-style) and prevents extra UI chrome/flicker.
        const shouldHideInputArea = getOverlayPresentation(ui.activeOverlay, approval) === 'focus';

        const placeholder = approval
            ? 'Approval required above...'
            : 'Type your message or /help for commands';

        // Expose submit method for external use (e.g., from OverlayContainer)
        // Pass bypassOverlayCheck=true since programmatic calls should skip the overlay check
        useImperativeHandle(ref, () => ({
            submit: (text: string) => handleSubmit(text, true),
        }));

        if (shouldHideInputArea) {
            return null;
        }

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
                highlightQuery={ui.historySearch.isActive ? ui.historySearch.query : undefined}
            />
        );
    }
);
