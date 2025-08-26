'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FileAudio, Play, Pause, Volume2, VolumeX, Download, Copy, Check } from 'lucide-react';
import { Button } from './button';

interface AudioWidgetProps {
  src: string;
  filename?: string;
  mimeType?: string;
  className?: string;
}

// Helper to validate audio data URI for security
function isValidAudioDataUri(src: string): boolean {
  const audioDataUriRegex = /^data:audio\/(mp3|mpeg|wav|webm|ogg|m4a|aac);base64,[A-Za-z0-9+/]+={0,2}$/i;
  return audioDataUriRegex.test(src);
}

// Helper to format duration
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper to format file size
function formatFileSize(base64Data: string): string {
  const bytes = (base64Data.length * 3) / 4;
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AudioWidget({ src, filename, mimeType, className = '' }: AudioWidgetProps) {
  // Validate audio data URI for security
  if (!isValidAudioDataUri(src)) {
    return (
      <div className={`flex items-center gap-3 p-4 rounded-lg border border-destructive/20 bg-destructive/5 ${className}`}>
        <FileAudio className="h-5 w-5 text-destructive" />
        <span className="text-sm text-destructive">
          Invalid audio data ({mimeType || 'unknown format'})
        </span>
      </div>
    );
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Validate audio data URI
  if (!isValidAudioDataUri(src)) {
    return (
      <div className={`flex items-center gap-3 p-4 rounded-lg border border-destructive/20 bg-destructive/5 ${className}`}>
        <FileAudio className="h-5 w-5 text-destructive" />
        <span className="text-sm text-destructive">
          Invalid audio data ({mimeType || 'unknown format'})
        </span>
      </div>
    );
  }

  // Extract base64 data for file operations
  const base64Data = src.split(',')[1] || '';
  const displayFilename = filename || `audio.${mimeType?.split('/')[1] || 'wav'}`;
  const fileSize = formatFileSize(base64Data);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedData = () => {
      setDuration(audio.duration);
      setIsLoading(false);
      setError(null);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    const handleError = () => {
      setError('Failed to load audio');
      setIsLoading(false);
    };

    audio.addEventListener('loadeddata', handleLoadedData);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        await audio.play();
        setIsPlaying(true);
      }
    } catch (err) {
      setError('Failed to play audio');
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newVolume = parseFloat(e.target.value);
    audio.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const progressBar = progressRef.current;
    if (!audio || !progressBar) return;

    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = (clickX / rect.width) * duration;
    
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const downloadAudio = () => {
    const link = document.createElement('a');
    link.href = src;
    link.download = displayFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(src);
      setShowCopySuccess(true);
      setTimeout(() => setShowCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy audio data:', err);
    }
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (error) {
    return (
      <div className={`flex items-center gap-3 p-4 rounded-lg border border-destructive/20 bg-destructive/5 ${className}`}>
        <FileAudio className="h-5 w-5 text-destructive" />
        <div className="flex-1">
          <div className="text-sm font-medium text-destructive">Audio Error</div>
          <div className="text-xs text-destructive/80">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 p-4 rounded-lg border border-border bg-card/50 ${className}`}>
      {/* Hidden audio element */}
      <audio ref={audioRef} src={src} preload="metadata" />
      
      {/* Header with file info */}
      <div className="flex items-center gap-3">
        <FileAudio className="h-5 w-5 text-primary" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" title={displayFilename}>
            {displayFilename}
          </div>
          <div className="text-xs text-muted-foreground">
            {mimeType} • {fileSize}
            {!isLoading && duration > 0 && ` • ${formatDuration(duration)}`}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={togglePlay}
          disabled={isLoading}
          className="h-8 w-8 p-0"
        >
          {isLoading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        {/* Progress bar */}
        <div className="flex-1">
          <div
            ref={progressRef}
            className="h-2 bg-muted rounded-full cursor-pointer group"
            onClick={handleProgressClick}
          >
            <div
              className="h-full bg-primary rounded-full transition-all group-hover:bg-primary/80"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{formatDuration(currentTime)}</span>
            <span>{duration > 0 ? formatDuration(duration) : '--:--'}</span>
          </div>
        </div>

        {/* Volume control */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            className="h-6 w-6 p-0"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-3 w-3" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
          </Button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-muted rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadAudio}
            className="h-6 w-6 p-0"
            title="Download audio"
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="h-6 w-6 p-0"
            title="Copy audio data"
          >
            {showCopySuccess ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}