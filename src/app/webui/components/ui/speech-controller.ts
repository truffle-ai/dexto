'use client';

type Subscriber = () => void;

class SpeechController {
    private _speaking = false;
    private subscribers = new Set<Subscriber>();
    private utterance: SpeechSynthesisUtterance | null = null;

    get supported() {
        return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    isSpeaking() {
        return this._speaking;
    }

    subscribe(cb: Subscriber) {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
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

        // Always stop any current speech first
        this.stop();

        const utter = new SpeechSynthesisUtterance(text);
        if (opts?.rate) utter.rate = opts.rate;
        if (opts?.pitch) utter.pitch = opts.pitch;
        if (opts?.lang) utter.lang = opts.lang;

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
            // Some browsers might not fire onstart immediately; ensure UI flips
            if (!this._speaking) {
                this._speaking = true;
                this.notify();
            }
        } catch {
            end();
        }
    }
}

export const speechController = new SpeechController();
