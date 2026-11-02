import { describe, expect, it } from 'vitest';
import { glyphText } from './glyphs.js';

describe('glyphText', () => {
    it('leaves text alone on unicode terminals', () => {
        expect(glyphText('▸ RUN · ◆', 'unicode')).toBe('▸ RUN · ◆');
    });

    it('maps status glyphs, separators and minus signs to ASCII', () => {
        expect(glyphText('▪ ▸ ▫ ◆ › · +12 −3', 'ascii')).toBe('* > . * > . +12 -3');
    });

    it('reduces braille spinner frames to ASCII', () => {
        expect(glyphText('⠋⣿', 'ascii')).toBe("'|");
    });

    it('keeps characters it has no mapping for', () => {
        expect(glyphText('dexto/sonnet-5.5', 'ascii')).toBe('dexto/sonnet-5.5');
    });
});
