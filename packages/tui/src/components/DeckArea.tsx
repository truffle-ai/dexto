/**
 * The Signal deck wired to the CLI: the band (wordmark, trace, status) above the input.
 * Mounted only on the Signal palette, so the legacy screens don't pay for its git and credit
 * lookups. The band stays up under overlays: hiding it would move the input in the tree and
 * remount it.
 */
import type { ReactNode } from 'react';
import { Deck } from '../signal/index.js';
import { useDeckState, type DeckStateInput } from '../hooks/useDeckState.js';

export interface DeckAreaProps extends DeckStateInput {
    children: ReactNode;
}

export function DeckArea({ children, ...input }: DeckAreaProps) {
    const state = useDeckState(input);
    return <Deck state={state}>{children}</Deck>;
}
