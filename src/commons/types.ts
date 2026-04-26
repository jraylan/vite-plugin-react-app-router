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
    /** True if this node lives inside an intercepting subtree */
    isIntercepting?: boolean;
    /** URL pattern of the source (parent of the intercepting marker) */
    interceptSource?: string;
    /** Parallel-route slots owned by this segment (siblings of layout.tsx) */
    slots?: ParallelSlot[];
    /**
     * If this node was produced by grafting a `[+name]/`/`(+name)/` invocation,
     * the active sub-shared names at that invocation (after applying any
     * `[-omit]/` overrides). Codegen uses this to emit a SharedModuleProvider
     * so descendants can query via useSharedModule(name).
     */
    sharedInvocation?: {
        name: string;
        activeSubShareds: string[];
    };
    /**
     * Path to a `props.tsx` (or .ts/.jsx/.js) file declared at this level of
     * a shared-module invocation. Codegen imports the default export and
     * wraps the subtree with a SharedPropsProvider; useSharedProps() reads it.
     */
    sharedPropsPath?: string;
    /**
     * Internal: marks a placeholder node inside a shared module's tree for a
     * nested sub-shared (`+sub/`). Carries the full sub-shared definition.
     * Replaced during grafting.
     */
    isSharedDef?: boolean;
    sharedDef?: SharedModuleDef;
}

/**
 * Definition of a `+name/` shared route module discovered during the first
 * parser pass. Materialized into the route tree at every `[+name]/` /
 * `(+name)/` invocation that can see it (visibility = siblings of the
 * directory that contains `+name/`).
 */
export interface SharedModuleDef {
    /** Name (without leading `+`). */
    name: string;
    /** Absolute path of the `+name/` directory itself. */
    dirPath: string;
    /** Parent directory of `+name/` — its siblings + descendants are the visibility scope. */
    containerDir: string;
    /** Files at `+name/` root. */
    layoutPath?: string;
    pagePath?: string;
    loadingPath?: string;
    errorPath?: string;
    notFoundPath?: string;
    /**
     * Subtree (children of `+name/`). Nodes with `isSharedDef` flag are
     * placeholders for nested sub-shareds, expanded at invocation time.
     */
    tree: RouteNode[];
    /** Sub-shareds discovered nested inside this module's tree (by name). */
    subShareds: Record<string, SharedModuleDef>;
}

/**
 * A parallel route slot (Next.js `@name/` convention). The slot's tree is
 * matched independently against the URL and exposed to the owning layout via
 * the `useSlot(name)` hook.
 */
export interface ParallelSlot {
    /** Slot name without the leading `@` (e.g. "modal" for `@modal/`). */
    name: string;
    /** Children of the slot dir, parsed as a normal route tree. */
    tree: RouteNode[];
    /** Slot's own page.tsx, if any. */
    pagePath?: string;
    /** Slot's own layout.tsx, if any. */
    layoutPath?: string;
    /** Slot's own loading.tsx, if any. */
    loadingPath?: string;
    /** Slot's own error.tsx, if any. */
    errorPath?: string;
    /** Slot's own not-found.tsx, if any. */
    notFoundPath?: string;
    /** Slot's `default.tsx`, rendered when no route in the slot matches. */
    defaultPath?: string;
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
    /** Map of layout path to its specific not-found component (for nested not-found support) */
    layoutNotFoundMap?: Map<string, string>;
}

/**
 * A route that intercepts another route when navigating from a specific source.
 * Mirrors Next.js App Router intercepting routes (`(.)`, `(..)`, `(..)(..)`, `(...)`).
 */
export interface InterceptedRoute {
    /** URL pattern for the source where interception originates (e.g., "/feed") */
    sourcePattern: string;
    /** URL pattern for the route being intercepted (e.g., "/photo/:id") */
    targetPattern: string;
    /** Path to the page.tsx of the intercepting route */
    pagePath: string;
    /** Loading component inherited from the source's tree (used for Suspense fallback) */
    loadingPath?: string;
}

export interface PluginOptions {
    /** App router directory (default: "src/app") */
    appDir?: string;
    /** Supported file extensions */
    extensions?: string[];
    /** 
     * Debug mode to visualize generated code
     * - true or 'console': logs to console
     * - string path: writes to file (e.g., './debug-routes.js')
     */
    debug?: boolean | 'console' | string;
    /**
     * Enable lazy loading for pages and layouts (default: true)
     * When enabled, pages are loaded on-demand using React.lazy() and dynamic imports,
     * resulting in smaller initial bundle size and better performance.
     */
    lazy?: boolean;
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
