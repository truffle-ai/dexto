import { Label } from '../../ui/label';
import { SpeechVoiceSelect } from '../../ui/speech-voice-select';

type VoiceSectionProps = {
    active?: boolean;
};

export function VoiceSection({ active = false }: VoiceSectionProps) {
    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
                Configure text-to-speech settings for voice output.
            </p>

            <div className="space-y-4">
                <div className="space-y-2">
                    <Label>Voice Selection</Label>
                    <p className="text-sm text-muted-foreground mb-3">
                        Choose a preferred text-to-speech voice. "Auto" selects the best available
                        voice on your device.
                    </p>
                    <SpeechVoiceSelect active={active} />
                </div>
            </div>
        </div>
    );
}
