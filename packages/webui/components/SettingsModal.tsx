'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Label } from './ui/label';
import { SpeechVoiceSelect } from './ui/speech-voice-select';

type SettingsModalProps = {
    isOpen: boolean;
    onClose: () => void;
};

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Configure preferences for speech and more.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-2">
                    <section className="space-y-2">
                        <Label className="text-xs uppercase text-muted-foreground">Voice</Label>
                        <p className="text-xs text-muted-foreground">
                            Choose a preferred text-to-speech voice. “Auto” selects the best
                            available voice on your device.
                        </p>
                        <SpeechVoiceSelect active={isOpen} />
                    </section>

                    {/* TODO: Future settings (e.g., streaming, theme, hotkeys) */}
                </div>
            </DialogContent>
        </Dialog>
    );
}
