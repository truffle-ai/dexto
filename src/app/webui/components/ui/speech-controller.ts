'use client';

import { useEffect, useState } from 'react';

type Subscriber = () => void;

class SpeechController {
    private _speaking = false;
    private subscribers = new Set<Subscriber>();
    private utterance: SpeechSynthesisUtterance | null = null;
    private voices: SpeechSynthesisVoice[] = [];
    private voiceSubscribers = new Set<Subscriber>();
    private preferredVoiceName: string | null = null;

    get supported() {
        return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    constructor() {
        if (this.supported) {
            try {
                const v = window.localStorage.getItem('ttsVoiceName');
                this.preferredVoiceName = v && v.length ? v : null;
            } catch {}

            const populate = () => {
                try {
                    const list = window.speechSynthesis.getVoices() || [];
                    const changed =
                        list.length !== this.voices.length ||
                        list.some((v, i) => v.name !== this.voices[i]?.name);
                    if (changed) {
                        this.voices = list;
                        this.voiceSubscribers.forEach((cb) => cb());
                    }
                } catch {}
            };
            populate();
            try {
                window.speechSynthesis.addEventListener('voiceschanged', populate as EventListener);
            } catch {}
        }
    }

    isSpeaking() {
        return this._speaking;
    }

    subscribe(cb: Subscriber) {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }

    subscribeVoices(cb: Subscriber) {
        this.voiceSubscribers.add(cb);
        return () => this.voiceSubscribers.delete(cb);
    }

    private notify() {
        for (const cb of this.subscribers) cb();
    }

    stop() {
        if (!this.supported) return;
        try {
            window.speechSynthesis.cancel();
        } catch {}
        this.utterance = null;
        if (this._speaking) {
            this._speaking = false;
            this.notify();
        }
    }

    speak(text: string, opts?: { rate?: number; pitch?: number; lang?: string }) {
        if (!this.supported) return;
        if (!text || !text.trim()) return;

        this.stop();

        const utter = new SpeechSynthesisUtterance(text);
        if (opts?.rate) utter.rate = opts.rate;
        if (opts?.pitch) utter.pitch = opts.pitch;
        const voice = this.resolveVoice();
        if (voice) {
            try {
                utter.voice = voice;
                utter.lang = voice.lang || opts?.lang || utter.lang;
            } catch {}
        } else if (opts?.lang) {
            utter.lang = opts.lang;
        }

        utter.onstart = () => {
            this._speaking = true;
            this.notify();
        };
        const end = () => {
            this._speaking = false;
            this.utterance = null;
            this.notify();
        };
        utter.onend = end;
        utter.onerror = end;

        try {
            window.speechSynthesis.speak(utter);
            this.utterance = utter;
            if (!this._speaking) {
                this._speaking = true;
                this.notify();
            }
        } catch {
            end();
        }
    }

    getVoices() {
        return this.voices;
    }
    setPreferredVoice(name: string | null) {
        this.preferredVoiceName = name && name.length ? name : null;
        try {
            if (this.preferredVoiceName)
                window.localStorage.setItem('ttsVoiceName', this.preferredVoiceName);
            else window.localStorage.removeItem('ttsVoiceName');
        } catch {}
        this.voiceSubscribers.forEach((cb) => cb());
    }
    getPreferredVoiceName() {
        return this.preferredVoiceName;
    }
    private resolveVoice(): SpeechSynthesisVoice | null {
        if (!this.voices.length) return null;
        const byName = this.preferredVoiceName
            ? this.voices.find((v) => v.name === this.preferredVoiceName)
            : null;
        if (byName) return byName;
        const score = (v: SpeechSynthesisVoice) => {
            const n = v.name.toLowerCase();
            let s = 0;
            if (/en\b|en-/.test(v.lang.toLowerCase())) s += 3;
            if (n.includes('google')) s += 5;
            if (n.includes('microsoft') || n.includes('azure')) s += 4;
            if (n.includes('natural') || n.includes('neural') || n.includes('premium')) s += 4;
            if (n.includes('siri')) s += 3;
            if (n.includes('female')) s += 1;
            return s;
        };
        const sorted = [...this.voices].sort((a, b) => score(b) - score(a));
        return sorted[0] || this.voices[0] || null;
    }
}

export const speechController = new SpeechController();

export function useSpeechVoices(): {
    voices: SpeechSynthesisVoice[];
    selected: string | null;
    setSelected: (name: string | null) => void;
} {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(speechController.getVoices());
    const [selected, setSelectedState] = useState<string | null>(
        speechController.getPreferredVoiceName()
    );

    useEffect(() => {
        const unsub = speechController.subscribeVoices(() => {
            setVoices(speechController.getVoices());
            setSelectedState(speechController.getPreferredVoiceName());
        });
        return () => unsub();
    }, []);

    const setSelected = (name: string | null) => {
        speechController.setPreferredVoice(name);
        setSelectedState(speechController.getPreferredVoiceName());
    };

    return { voices, selected, setSelected };
}
