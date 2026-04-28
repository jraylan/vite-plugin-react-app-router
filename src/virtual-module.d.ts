/**
 * Type declarations for the virtual module
 */

/// <reference types="react" />

declare module 'virtual:app-router' {
    import type { FC } from 'react';
    import type { RouteObject, createBrowserRouter } from 'react-router-dom';
    import type { TemplateLinkFn } from 'vite-plugin-react-app-router/runtime';

    /**
     * Main router component
     * Renders the RouterProvider with all generated routes
     */
    export const AppRouter: FC;

    /**
     * Router instance created with createBrowserRouter.
     * `null` in intercept mode — that build path uses <BrowserRouter> +
     * useRoutes() instead of the data router, so no instance exists.
     */
    export const router: ReturnType<typeof createBrowserRouter> | null;

    /**
     * Array of route objects for custom use
     */
    export const routes: RouteObject[];

    /**
     * Hook that resolves a template path against the build-time registry of
     * shared route module invocations. Example:
     *   const templateLink = useTemplateLink();
     *   <Link to={templateLink('cliente/:id', { id })}>...</Link>
     */
    export const useTemplateLink: () => TemplateLinkFn;

    // Runtime hooks re-exported from `vite-plugin-react-app-router/runtime`
    // so consumers can pull them from the virtual module alongside AppRouter.
    export {
        useSlot,
        useSharedModule,
        useSharedSlot,
        useSharedProps,
    } from 'vite-plugin-react-app-router/runtime';

    const _default: FC;
    export default _default;
}
