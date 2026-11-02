/**
 * The Signal deck wired to the CLI: the band (wordmark, trace, status) above the input.
 * Mounted only on the Signal palette, so the legacy screens don't pay for its git and credit
 * lookups. Focused overlays budget for the whole screen, so the band collapses under them
 * while the Deck stays mounted, which keeps the input in place in the tree. It stays up during
 * an approval, where its mode says the agent is waiting.
 */
import type { ReactNode } from 'react';
import { Deck } from '../signal/index.js';
import { useDeckState, type DeckStateInput } from '../hooks/useDeckState.js';
import { deckCollapsed } from '../utils/deck-state.js';

export interface DeckAreaProps extends DeckStateInput {
    children: ReactNode;
}

export function DeckArea({ children, ...input }: DeckAreaProps) {
    const state = useDeckState(input);
    return (
        <Deck state={state} collapsed={deckCollapsed(input.ui.activeOverlay)}>
            {children}
        </Deck>
    );
}
