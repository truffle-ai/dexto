import { useRef } from 'react';

/** `value`, except that while `held` it stays at what it was when the hold began. */
export function useHeldValue<T>(value: T, held: boolean): T {
    const shown = useRef(value);
    if (!held) shown.current = value;
    return shown.current;
}
