import React, { useEffect, useState } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useSpeechVoices } from '@/components/ui/speech-controller';

type SpeechVoiceSelectProps = {
    active?: boolean;
    id?: string;
};

export function SpeechVoiceSelect({ active = false, id }: SpeechVoiceSelectProps) {
    const { voices, selected, setSelected } = useSpeechVoices();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!active) {
            setReady(false);
            return;
        }
        const idleId = (window as any).requestIdleCallback
            ? (window as any).requestIdleCallback(() => setReady(true))
            : setTimeout(() => setReady(true), 0);
        return () => {
            if ((window as any).cancelIdleCallback && typeof idleId === 'number')
                (window as any).cancelIdleCallback(idleId);
            else clearTimeout(idleId as any);
        };
    }, [active]);

    const onChange = (val: string) => {
        const name = val === 'auto' ? null : val;
        setSelected(name);
    };

    if (!active) return null;

    return (
        <Select value={selected ?? 'auto'} onValueChange={onChange}>
            <SelectTrigger id={id} className="h-8 w-[12rem] text-xs">
                <SelectValue placeholder="Voice" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="auto">Auto (best available)</SelectItem>
                {ready &&
                    voices.map((v) => (
                        <SelectItem key={`${v.name}-${v.lang}`} value={v.name}>
                            {v.name} ({v.lang})
                        </SelectItem>
                    ))}
            </SelectContent>
        </Select>
    );
}
