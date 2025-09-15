/**
 * Internal resources provider and registry
 */

export { InternalResourcesProvider } from './internal-provider.js';

export {
    createInternalResourceHandler,
    getInternalResourceHandlerTypes,
} from './internal-registry.js';
export type {
    InternalResourceConfig,
    InternalResourceHandler,
    InternalResourceServices,
} from './internal-registry.js';
