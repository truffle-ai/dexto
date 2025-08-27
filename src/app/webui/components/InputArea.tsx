'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ContentEditableInput from './ContentEditableInput';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Paperclip, SendHorizontal, X, Loader2, Bot, ChevronDown, AlertCircle, Zap, Mic, StopCircle, FileAudio, File, Search } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { useChatContext } from './hooks/ChatContext';
import { Switch } from './ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';

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
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [fileData, setFileData] = useState<{ base64: string; mimeType: string; filename?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Get current session context to ensure model switch applies to the correct session
  const { currentSessionId, isStreaming, setStreaming } = useChatContext();
  
  // LLM selector state
  const [currentModel, setCurrentModel] = useState('Loading...');
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [modelSwitchError, setModelSwitchError] = useState<string | null>(null);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  
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
            setCurrentModel(matchedModel.name);
          } else {
            // Fallback to provider/model display
            setCurrentModel(`${config.config.provider}/${config.config.model}`);
          }
        }
      } catch (error) {
        console.error('Failed to fetch current model:', error);
        setCurrentModel('Unknown');
      }
    };

    fetchCurrentModel();
  }, [currentSessionId]); // Re-fetch whenever the session changes

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
  const handlePaste = (e: React.ClipboardEvent) => {
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

  const handleModelSwitch = async (model: { name: string; provider: string; model: string }) => {
    setIsLoadingModel(true);
    setModelSwitchError(null); // Clear any previous errors
    try {
      const requestBody: any = {
        provider: model.provider,
        model: model.model,
        router: 'vercel'
      };

      // Include current session ID to ensure model switch applies to the correct session
      // If there's no active session, it will fall back to the default session behavior
      if (currentSessionId) {
        requestBody.sessionId = currentSessionId;
      }

      const response = await fetch('/api/llm/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      const result = await response.json();

      if (response.ok) {
        setCurrentModel(model.name);
        setModelSwitchError(null); // Clear any errors on success
      } else {
        // Handle new validation error format
        let errorMessage = 'Failed to switch model';
        if (result.issues && result.issues.length > 0) {
          const errors = result.issues.filter((issue: any) => issue.severity === 'error');
          if (errors.length > 0) {
            errorMessage = errors[0].message;
          }
        } else if (result.error) {
          // Fallback to old format
          errorMessage = result.error;
        }
        
        console.error('Failed to switch model:', errorMessage);
        setModelSwitchError(errorMessage);
        
        // Auto-clear error after 10 seconds
        setTimeout(() => setModelSwitchError(null), 10000);
      }
    } catch (error) {
      console.error('Network error while switching model:', error);
      const errorMessage = 'Network error while switching model';
      setModelSwitchError(errorMessage);
      
      // Auto-clear error after 10 seconds
      setTimeout(() => setModelSwitchError(null), 10000);
    } finally {
      setIsLoadingModel(false);
    }
  };

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
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative">
          <div className="relative">
            <Search className="absolute left-4 top-[28px] -translate-y-1/2 h-5 w-5 text-muted-foreground z-10" />
            <ContentEditableInput
              value={text}
              onChange={setText}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask Dexto anything..."
              className=""
            />
            <Button
              type="submit"
              disabled={!text.trim() && !imageData && !fileData || isSending}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-10 p-0 rounded-full shadow-sm hover:shadow-md transition-shadow"
              aria-label="Send message"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>

        {/* Previews below input */}
        {(imageData || fileData) && (
          <div className="mt-3 flex items-center gap-2">
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
        )}

        {/* Controls row: attach/record on left, streaming/model on right */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground rounded-full"
                  aria-label="Attach File"
                >
                  <Paperclip className="h-3 w-3 mr-1.5" />
                  Attach
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem onClick={triggerFileInput}>
                  <Paperclip className="h-4 w-4 mr-2" /> Image
                </DropdownMenuItem>
                <DropdownMenuItem onClick={triggerPdfInput}>
                  <File className="h-4 w-4 mr-2" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={triggerAudioInput}>
                  <FileAudio className="h-4 w-4 mr-2" /> Audio file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={isRecording ? stopRecording : startRecording}
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground rounded-full"
              aria-label={isRecording ? 'Stop recording' : 'Record audio'}
            >
              {isRecording ? <StopCircle className="h-3 w-3 mr-1.5 text-red-500" /> : <Mic className="h-3 w-3 mr-1.5" />}
              {isRecording ? 'Stop' : 'Record'}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-pointer">
                    <Zap className={`h-3 w-3 ${isStreaming ? 'text-blue-500' : 'text-muted-foreground'}`} />
                    <Switch
                      checked={isStreaming}
                      onCheckedChange={setStreaming}
                      className="scale-75"
                      aria-label="Toggle streaming"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{isStreaming ? 'Streaming enabled' : 'Streaming disabled'}</p>
                  <p className="text-xs opacity-75">
                    {isStreaming ? 'Responses will stream in real-time' : 'Responses will arrive all at once'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground rounded-full"
                  disabled={isLoadingModel}
                >
                  <Bot className="h-3 w-3 mr-1.5" />
                  <span className="hidden sm:inline">
                    {isLoadingModel ? '...' : currentModel}
                  </span>
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {coreModels.map((model) => (
                  <DropdownMenuItem 
                    key={model.model}
                    onClick={() => handleModelSwitch(model)}
                  >
                    <Bot className="h-4 w-4 mr-2" />
                    {model.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

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
