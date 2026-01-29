import type {
    Plugin,
} from 'vite';

/**
 * Shared types between server and build
 */

export interface RouteNode {
    /** Segment path (e.g., "blog", "[id]", "(group)") */
    segment: string;
    /** Full route path (e.g., "/blog/[id]") */
    path: string;
    /** Absolute path to page.tsx if it exists */
    pagePath?: string;
    /** Absolute path to layout.tsx if it exists */
    layoutPath?: string;
    /** Absolute path to loading.tsx if it exists */
    loadingPath?: string;
    /** Absolute path to error.tsx if it exists */
    errorPath?: string;
    /** Absolute path to not-found.tsx if it exists */
    notFoundPath?: string;
    /** Child routes */
    children: RouteNode[];
    /** Is a dynamic parameter? [param] */
    isDynamic: boolean;
    /** Is a catch-all? [...param] */
    isCatchAll: boolean;
    /** Is an optional catch-all? [[...param]] */
    isOptionalCatchAll: boolean;
    /** Parameter name if dynamic */
    paramName?: string;
    /** Is a route group? (group) */
    isGroup: boolean;
}

export interface ParsedRoute {
    /** Route pattern for react-router (e.g., "/blog/:id") */
    pattern: string;
    /** Path to page.tsx */
    pagePath: string;
    /** List of layouts to apply (from outermost to innermost) */
    layouts: string[];
    /** Loading component path (closest to the route) */
    loadingPath?: string;
    /** Error component path (closest to the route) */
    errorPath?: string;
    /** Not found component path (closest to the route) */
    notFoundPath?: string;
}

export interface PluginOptions {
    /** App router directory (default: "src/app") */
    appDir?: string;
    /** Supported file extensions */
    extensions?: string[];
}

export interface GeneratedRouteCode {
    /** Generated virtual module code */
    code: string;
    /** Required imports */
    imports: string[];
}


type UnwrapObjectHook<H> = H extends { handler: infer U } ? U : H;

export type PluginHookHandler = {
    config?: UnwrapObjectHook<Plugin['config']>;
    configEnvironment?: UnwrapObjectHook<Plugin['configEnvironment']>;
    configResolved?: UnwrapObjectHook<Plugin['configResolved']>;
    configureServer?: UnwrapObjectHook<Plugin['configureServer']>;
    configurePreviewServer?: UnwrapObjectHook<Plugin['configurePreviewServer']>;
    handleHotUpdate?: UnwrapObjectHook<Plugin['handleHotUpdate']>;
    buildApp?: UnwrapObjectHook<Plugin['buildApp']>;
}


export type Context = {
    handler?: PluginHookHandler,
}
