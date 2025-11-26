import React, { useEffect, useState } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useSpeechVoices } from '@/components/ui/speech-controller';

export function SpeechVoiceSelect({ active = false }: { active?: boolean }) {
    const { voices, selected, setSelected } = useSpeechVoices();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!active) {
            setReady(false);
            return;
        }
        const id = (window as any).requestIdleCallback
            ? (window as any).requestIdleCallback(() => setReady(true))
            : setTimeout(() => setReady(true), 0);
        return () => {
            if ((window as any).cancelIdleCallback && typeof id === 'number')
                (window as any).cancelIdleCallback(id);
            else clearTimeout(id as any);
        };
    }, [active]);

    const onChange = (val: string) => {
        const name = val === 'auto' ? null : val;
        setSelected(name);
    };

    if (!active) return null;

    return (
        <Select value={selected ?? 'auto'} onValueChange={onChange}>
            <SelectTrigger className="h-8 w-[12rem] text-xs">
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
