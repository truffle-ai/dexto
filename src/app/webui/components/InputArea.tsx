'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Button } from './ui/button';
import { ChatInputContainer, ButtonFooter, StreamToggle, AttachButton, RecordButton } from './ChatInput';
import ModelPickerModal from './ModelPicker';
import { Badge } from './ui/badge';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Paperclip, SendHorizontal, X, Loader2, Bot, ChevronDown, AlertCircle, Zap, Mic, Square, FileAudio, File, Search } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { useChatContext } from './hooks/ChatContext';
import { Switch } from './ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';
import { useFontsReady } from './hooks/useFontsReady';
import { cn } from '../lib/utils';

interface ModelOption {
  name: string;
  provider: string;
  model: string;
}

interface InputAreaProps {
  onSend: (
    content: string,
    imageData?: { base64: string; mimeType: string },
    fileData?: { base64: string; mimeType: string; filename?: string }
  ) => void;
  isSending?: boolean;
  variant?: 'welcome' | 'chat';
}

export default function InputArea({ onSend, isSending, variant = 'chat' }: InputAreaProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [fileData, setFileData] = useState<{ base64: string; mimeType: string; filename?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  
  // TODO(unify-fonts): Defer autosize until fonts are ready to avoid
  // initial one-line height jump due to font swap metrics. Remove this
  // once the app uses a single font pipeline without swap. 
  // Currently it looks like only 'Welcome to Dexto' is using the older font - (checked with chrome dev tools)
  const fontsReady = useFontsReady();

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Get current session context to ensure model switch applies to the correct session
  const { currentSessionId, isStreaming, setStreaming, cancel, processing, currentLLM } = useChatContext();
  
  // LLM selector state
  const [currentModel, setCurrentModel] = useState<ModelOption | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [modelSwitchError, setModelSwitchError] = useState<string | null>(null);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const [supportedFileTypes, setSupportedFileTypes] = useState<string[]>([]);
  
  // TODO: Populate using LLM_REGISTRY by exposing an API endpoint
  const coreModels = [
    { name: 'Claude 4 Sonnet', provider: 'anthropic', model: 'claude-4-sonnet-20250514' },
    { name: 'GPT-4o', provider: 'openai', model: 'gpt-4o' },
    { name: 'GPT-4.1 Mini', provider: 'openai', model: 'gpt-4.1-mini' },
    { name: 'Gemini 2.5 Pro', provider: 'google', model: 'gemini-2.5-pro' },
  ];

  // File size limit (64MB)
  const MAX_FILE_SIZE = 64 * 1024 * 1024; // 64MB in bytes

  const showUserError = (message: string) => {
    setFileUploadError(message);
    // Auto-clear error after 5 seconds
    setTimeout(() => setFileUploadError(null), 5000);
  };

  // Fetch current LLM configuration
  useEffect(() => {
    const fetchCurrentModel = async () => {
      try {
        // Include session ID in the request to get the model for the specific session
        const url = currentSessionId 
          ? `/api/llm/current?sessionId=${currentSessionId}` 
          : '/api/llm/current';
        
        const response = await fetch(url);
        if (response.ok) {
          const config = await response.json();
          // Try to match with core models first
          const matchedModel = coreModels.find(m => m.model === config.config.model);
          if (matchedModel) {
            setCurrentModel(matchedModel);
          } else {
            // Fallback to provider/model display - create a ModelOption
            setCurrentModel({
              name: `${config.config.provider}/${config.config.model}`,
              provider: config.config.provider,
              model: config.config.model
            });
          }
        }
      } catch (error) {
        console.error('Failed to fetch current model:', error);
        setCurrentModel(null);
      }
    };

    fetchCurrentModel();
  }, [currentSessionId]); // Re-fetch whenever the session changes

  // Fetch supported file types for the active model to drive Attach menu
  useEffect(() => {
    const loadSupportedFileTypes = async () => {
      try {
        const res = await fetch('/api/llm/catalog?mode=flat');
        if (!res.ok) return;
        const data = await res.json();
        const models: Array<{ provider: string; name: string; supportedFileTypes?: string[] }> = data.models || [];
        const provider = currentLLM?.provider;
        const model = currentLLM?.model;
        if (!provider || !model) return;
        const match = models.find(m => m.provider === provider && m.name === model);
        setSupportedFileTypes(match?.supportedFileTypes || []);
      } catch (e) {
        // ignore – default to []
        setSupportedFileTypes([]);
      }
    };
    loadSupportedFileTypes();
  }, [currentLLM?.provider, currentLLM?.model]);

  // NOTE: We intentionally do not manually resize the textarea. We rely on
  // CSS max-height + overflow to keep layout stable.

  const handleSend = () => {
    const trimmed = text.trim();
    // Allow sending if we have text OR any attachment
    if (!trimmed && !imageData && !fileData) return;
    onSend(trimmed, imageData ?? undefined, fileData ?? undefined);
    setText('');
    setImageData(null);
    setFileData(null);
    // Height handled by CSS; no imperative adjustments.
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Large paste guard to prevent layout from exploding with very large text
  const LARGE_PASTE_THRESHOLD = 20000; // characters
  const toBase64 = (str: string) => {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch {
      return btoa(str);
    }
  };
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted) return;
    if (pasted.length <= LARGE_PASTE_THRESHOLD) return;
    e.preventDefault();
    const attach = window.confirm(
      'Large text detected. Attach as a file instead of inflating the input?\n(OK = attach as file, Cancel = paste truncated preview)'
    );
    if (attach) {
      setFileData({ base64: toBase64(pasted), mimeType: 'text/plain', filename: 'pasted.txt' });
    } else {
      const preview = pasted.slice(0, LARGE_PASTE_THRESHOLD);
      setText((prev) => prev + preview);
    }
  };

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // File size validation
    if (file.size > MAX_FILE_SIZE) {
      showUserError('PDF file too large. Maximum size is 64MB.');
      e.target.value = '';
      return;
    }

    if (file.type !== 'application/pdf') {
      showUserError('Please select a valid PDF file.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const result = reader.result as string;
        const commaIndex = result.indexOf(',');
        const base64 = result.substring(commaIndex + 1);
        setFileData({ base64, mimeType: 'application/pdf', filename: file.name });
        setFileUploadError(null); // Clear any previous errors
      } catch (error) {
        showUserError('Failed to process PDF file. Please try again.');
        setFileData(null);
      }
    };
    reader.onerror = (error) => {
      showUserError('Failed to read PDF file. Please try again.');
      setFileData(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Audio Recording Handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          try {
            const result = reader.result as string;
            const commaIndex = result.indexOf(',');
            const base64 = result.substring(commaIndex + 1);
            // Preserve original MIME type and determine appropriate extension
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            const getExtensionFromMime = (mime: string): string => {
              const mimeToExt: Record<string, string> = {
                'audio/mp3': 'mp3',
                'audio/mpeg': 'mp3', 
                'audio/wav': 'wav',
                'audio/x-wav': 'wav',
                'audio/wave': 'wav',
                'audio/webm': 'webm',
                'audio/ogg': 'ogg',
                'audio/m4a': 'm4a',
                'audio/aac': 'aac'
              };
              return mimeToExt[mime] || mime.split('/')[1] || 'webm';
            };
            const ext = getExtensionFromMime(mimeType);

            setFileData({
              base64,
              mimeType: mimeType,
              filename: `recording.${ext}`,
            });
          } catch (error) {
            showUserError('Failed to process audio recording. Please try again.');
            setFileData(null);
          }
        };
        reader.readAsDataURL(blob);

        // Stop all tracks to release microphone
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      showUserError('Failed to start audio recording. Please check microphone permissions.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // File size validation
    if (file.size > MAX_FILE_SIZE) {
      showUserError('Image file too large. Maximum size is 64MB.');
      e.target.value = '';
      return;
    }

    if (!file.type.startsWith('image/')) {
      showUserError('Please select a valid image file.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const result = reader.result as string;
        const commaIndex = result.indexOf(',');
        if (commaIndex === -1) throw new Error("Invalid Data URL format");

        const meta = result.substring(0, commaIndex);
        const base64 = result.substring(commaIndex + 1);

        const mimeMatch = meta.match(/data:(.*);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : file.type;

        if (!mimeType) throw new Error("Could not determine MIME type");

        setImageData({ base64, mimeType });
        setFileUploadError(null); // Clear any previous errors
      } catch (error) {
          showUserError('Failed to process image file. Please try again.');
          setImageData(null);
      }
    };
    reader.onerror = (error) => {
        showUserError('Failed to read image file. Please try again.');
        setImageData(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const removeImage = () => setImageData(null);

  const triggerFileInput = () => fileInputRef.current?.click();
  const triggerPdfInput = () => pdfInputRef.current?.click();
  const triggerAudioInput = () => audioInputRef.current?.click();

  // Clear model switch error when user starts typing
  useEffect(() => {
    if (text && modelSwitchError) {
      setModelSwitchError(null);
    }
    if (text && fileUploadError) {
      setFileUploadError(null);
    }
  }, [text, modelSwitchError]);

  const showClearButton = text.length > 0 || !!imageData || !!fileData;

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // File size validation
    if (file.size > MAX_FILE_SIZE) {
      showUserError('Audio file too large. Maximum size is 64MB.');
      e.target.value = '';
      return;
    }

    if (!file.type.startsWith('audio/')) {
      showUserError('Please select a valid audio file.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const result = reader.result as string;
        const commaIndex = result.indexOf(',');
        const base64 = result.substring(commaIndex + 1);
        // Preserve original MIME type from file
        setFileData({ base64, mimeType: file.type, filename: file.name });
        setFileUploadError(null); // Clear any previous errors
      } catch (error) {
        showUserError('Failed to process audio file. Please try again.');
        setFileData(null);
      }
    };
    reader.onerror = (error) => {
      showUserError('Failed to read audio file. Please try again.');
      setFileData(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Unified input panel: use the same full-featured chat composer in both welcome and chat states

  // Chat variant - full featured input area
  return (
    <div
      id="input-area"
      className="flex flex-col gap-2 w-full"
    >
      {/* Model Switch Error Alert */}
      {modelSwitchError && (
        <Alert variant="destructive" className="mb-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{modelSwitchError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModelSwitchError(null)}
              className="h-auto p-1 ml-2"
            >
              <X className="h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* File Upload Error Alert */}
      {fileUploadError && (
        <Alert variant="destructive" className="mb-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{fileUploadError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFileUploadError(null)}
              className="h-auto p-1 ml-2"
            >
              <X className="h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="w-full">
        {/* Unified pill input with send button */}
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
          <ChatInputContainer>
            {/* Attachments strip (inside bubble, above editor) */}
            {(imageData || fileData) && (
              <div className="px-4 pt-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {imageData && (
                    <div className="relative w-fit border border-border rounded-lg p-1 bg-muted/50 group">
                      <img
                        src={`data:${imageData.mimeType};base64,${imageData.base64}`}
                        alt="preview"
                        className="h-12 w-auto rounded-md"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={removeImage}
                        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-100 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                        aria-label="Remove image"
                      >
                        <X className="h-2 w-2" />
                      </Button>
                    </div>
                  )}
                  {fileData && (
                    <div className="relative w-fit border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group">
                      {fileData.mimeType.startsWith('audio') ? (
                        <>
                          <FileAudio className="h-4 w-4" />
                          <audio controls src={`data:${fileData.mimeType};base64,${fileData.base64}`} className="h-8" />
                        </>
                      ) : (
                        <>
                          <File className="h-4 w-4" />
                          <span className="text-xs font-medium max-w-[160px] truncate">{fileData.filename || 'attachment'}</span>
                        </>
                      )}
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => setFileData(null)}
                        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-100 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                        aria-label="Remove attachment"
                      >
                        <X className="h-2 w-2" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Editor area: scrollable, independent from footer */}
            <div className="flex-auto overflow-y-auto">
              {fontsReady ? (
                <TextareaAutosize
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Ask Dexto anything..."
                  minRows={1}
                  maxRows={8}
                  className="w-full px-4 pt-4 pb-1 text-lg leading-7 placeholder:text-lg bg-transparent border-none resize-none outline-none ring-0 ring-offset-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none max-h-full"
                />
              ) : (
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Ask Dexto anything..."
                  className="w-full px-4 pt-4 pb-1 text-lg leading-7 placeholder:text-lg bg-transparent border-none resize-none outline-none ring-0 ring-offset-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                />
              )}
            </div>

            {/* Footer row: normal flow */}
            <ButtonFooter
              leftButtons={
                <div className="flex items-center gap-2">
                  <AttachButton
                    onImageAttach={triggerFileInput}
                    onPdfAttach={triggerPdfInput}
                    onAudioAttach={triggerAudioInput}
                    supports={{
                      // If not yet loaded (length===0), pass undefined so AttachButton defaults to enabled
                      image: supportedFileTypes.length ? supportedFileTypes.includes('image') : undefined,
                      pdf: supportedFileTypes.length ? supportedFileTypes.includes('pdf') : undefined,
                      audio: supportedFileTypes.length ? supportedFileTypes.includes('audio') : undefined,
                    }}
                  />
                  
                  <RecordButton
                    isRecording={isRecording}
                    onToggleRecording={isRecording ? stopRecording : startRecording}
                    disabled={!supportedFileTypes.includes('audio')}
                  />
                </div>
              }
              rightButtons={
                <div className="flex items-center gap-2">
                  <StreamToggle 
                    isStreaming={isStreaming}
                    onStreamingChange={setStreaming}
                  />
                  
                  <ModelPickerModal />

                  {/* Stop/Cancel button shown when a run is in progress */}
                  <Button
                    type={processing ? 'button' : 'submit'}
                    onClick={processing ? () => cancel(currentSessionId || undefined) : undefined}
                    disabled={processing ? false : ((!text.trim() && !imageData && !fileData) || isSending)}
                    className={cn(
                      "h-10 w-10 p-0 rounded-full transition-all duration-200",
                      processing
                        ? "bg-secondary/80 text-secondary-foreground hover:bg-secondary shadow-sm hover:shadow-md border border-border/50"
                        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-lg"
                    )}
                    aria-label={processing ? 'Stop' : 'Send message'}
                    title={processing ? 'Stop' : 'Send'}
                  >
                    {processing ? (
                      <Square className="h-3.5 w-3.5 fill-current" />
                    ) : isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <SendHorizontal className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              }
            />
          </ChatInputContainer>
        </form>

        {/* Previews moved inside bubble above editor */}


        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          id="image-upload"
          accept="image/*"
          className="hidden"
          onChange={handleImageChange}
        />
        <input
          ref={pdfInputRef}
          type="file"
          id="pdf-upload"
          accept="application/pdf"
          className="hidden"
          onChange={handlePdfChange}
        />
        <input
          ref={audioInputRef}
          type="file"
          id="audio-upload"
          accept="audio/*"
          className="hidden"
          onChange={handleAudioFileChange}
        />
      </div>
    </div>
  );
} 
