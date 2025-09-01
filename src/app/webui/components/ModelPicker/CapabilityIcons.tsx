"use client";

import React from 'react';
import { Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { CAPABILITY_ICONS } from "./constants";

interface CapabilityIconsProps {
  supportedFileTypes: string[];
  hasApiKey: boolean;
  className?: string;
}

export function CapabilityIcons({ supportedFileTypes, hasApiKey, className }: CapabilityIconsProps) {
  return (
    <div className={`flex items-center gap-1.5 flex-shrink-0 ${className || ''}`}>
      {supportedFileTypes.includes('pdf') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="transition-transform hover:scale-125">
              {CAPABILITY_ICONS.pdf}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>PDF support</span>
          </TooltipContent>
        </Tooltip>
      )}
      
      {supportedFileTypes.includes('audio') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="transition-transform hover:scale-125">
              {CAPABILITY_ICONS.audio}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Audio support</span>
          </TooltipContent>
        </Tooltip>
      )}
      
      {supportedFileTypes.includes('image') && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="transition-transform hover:scale-125">
              {CAPABILITY_ICONS.image}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Image support</span>
          </TooltipContent>
        </Tooltip>
      )}
      
      {!hasApiKey && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="transition-transform hover:scale-125">
              <Lock className="h-3.5 w-3.5 text-amber-500 hover:text-amber-400 transition-colors cursor-help" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>API key required</span>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}