/**
 * Context providers for ink-cli
 */

export {
    KeypressProvider,
    useKeypressContext,
    type Key,
    type KeypressHandler,
    type KeypressProviderProps,
} from './KeypressContext.js';

export {
    MouseProvider,
    useMouseContext,
    useMouse,
    type MouseEvent,
    type MouseEventName,
    type MouseHandler,
    type MouseProviderProps,
} from './MouseContext.js';

export {
    ScrollProvider,
    useScrollable,
    type ScrollState,
    type ScrollableEntry,
} from './ScrollProvider.js';

export { SoundProvider, useSoundService } from './SoundContext.js';
