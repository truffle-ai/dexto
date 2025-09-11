"use client";

import { useState } from "react";
import { Check as CheckIcon, Copy as CopyIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";

export type CopyButtonProps = {
  value: string;
  tooltip?: string;
  copiedTooltip?: string;
  className?: string;
  size?: number;
};

export function CopyButton({
  value,
  tooltip = "Copy",
  copiedTooltip = "Copied!",
  className,
  size = 12,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <TooltipIconButton
      tooltip={copied ? copiedTooltip : tooltip}
      onClick={onCopy}
      className={className}
    >
      {copied ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
    </TooltipIconButton>
  );
}

