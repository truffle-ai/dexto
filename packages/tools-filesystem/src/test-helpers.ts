import type { BlockedPathCheck } from './blocked-path-check.js';

/** A blocked-path check that blocks nothing, for tests that are not about blocking. */
export const allowAllPaths: BlockedPathCheck = async () => null;
