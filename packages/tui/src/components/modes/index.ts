/**
 * CLI Rendering Modes
 *
 * Two rendering modes are available:
 * - AlternateBufferCLI: VirtualizedList with mouse scroll, keyboard scroll, copy mode
 * - StaticCLI: Static pattern with native terminal scrollback and selection
 */

export { AlternateBufferCLI } from './AlternateBufferCLI.js';
export { StaticCLI } from './StaticCLI.js';
