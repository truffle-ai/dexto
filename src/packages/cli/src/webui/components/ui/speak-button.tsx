"use client";

import { useEffect, useState } from "react";
import { Volume2 as VolumeIcon, Square as StopIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { speechController } from "@/components/ui/speech-controller";

export type SpeakButtonProps = {
  value: string;
  tooltip?: string;
  stopTooltip?: string;
  className?: string;
  rate?: number;
  pitch?: number;
  lang?: string;
};

export function SpeakButton({
  value,
  tooltip = "Speak",
  stopTooltip = "Stop",
  className,
  rate = 1,
  pitch = 1,
  lang,
}: SpeakButtonProps) {
  const [speaking, setSpeaking] = useState(false);
  const supported = speechController.supported;
  const hasText = (value ?? "").trim().length > 0;
  useEffect(() => {
    setSpeaking(speechController.isSpeaking());
    return speechController.subscribe(() => setSpeaking(speechController.isSpeaking()));
  }, []);

  const onClick = () => {
    if (!supported || !hasText) return;
    if (speaking) return speechController.stop();
    speechController.speak(value, { rate, pitch, lang });
  };

  return (
    <TooltipIconButton
      tooltip={speaking ? stopTooltip : tooltip}
      onClick={onClick}
      className={className}
      disabled={!supported || !hasText}
    >
      {speaking ? <StopIcon size={12} /> : <VolumeIcon size={12} />}
    </TooltipIconButton>
  );
}
