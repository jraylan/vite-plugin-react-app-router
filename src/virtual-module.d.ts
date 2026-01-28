/**
 * Type declarations for the virtual module
 */

/// <reference types="react" />

declare module 'virtual:app-router' {
    import type { FC } from 'react';
    import type { RouteObject, createBrowserRouter } from 'react-router-dom';

    /**
     * Main router component
     * Renders the RouterProvider with all generated routes
     */
    export const AppRouter: FC;

    /**
     * Router instance created with createBrowserRouter
     */
    export const router: ReturnType<typeof createBrowserRouter>;

    /**
     * Array of route objects for custom use
     */
    export const routes: RouteObject[];

    const _default: FC;
    export default _default;
}
