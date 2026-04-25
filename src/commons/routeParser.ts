/**
 * Directory structure parser for routes
 * Follows Next.js App Router conventions
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RouteNode, ParsedRoute, InterceptedRoute, PluginOptions } from './types.js';

const DEFAULT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Matches Next.js intercepting-route markers at the start of a directory name:
 *   (.)foo, (..)foo, (...)foo, (..)(..)foo, (..)(..)(..)foo, ...
 *
 * The `(...)` form (root) is mutually exclusive with the dot/dotdot forms, so
 * we accept either: a single `(.)`/`(...)` or one-or-more `(..)` groups.
 */
const INTERCEPTING_MARKER_RE = /^(\(\.\.\.\)|\(\.\)|(?:\(\.\.\))+)(.+)$/;

/**
 * `'root'` for `(...)`, `'same'` for `(.)`, or the number of route levels to
 * climb for `(..)`, `(..)(..)`, `(..)(..)(..)`, ...
 */
type InterceptLevel = 'root' | 'same' | number;

/**
 * Checks if a file exists with one of the supported extensions
 */
function findFileWithExtension(
    basePath: string,
    fileName: string,
    extensions: string[]
): string | undefined {
    for (const ext of extensions) {
        const filePath = path.join(basePath, `${fileName}${ext}`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return undefined;
}

interface SegmentInfo {
    isDynamic: boolean;
    isCatchAll: boolean;
    isOptionalCatchAll: boolean;
    isGroup: boolean;
    paramName?: string;
    routeSegment: string;
    /** Set when the directory name starts with an intercepting marker */
    interceptLevel?: InterceptLevel;
}

/**
 * Parses the segment name to extract dynamic route and intercept information
 */
function parseSegment(segment: string): SegmentInfo {
    // Intercepting routes: (.), (..), (...), (..)(..), ...
    // The marker is followed by a regular segment name — recurse to parse it.
    const interceptMatch = segment.match(INTERCEPTING_MARKER_RE);
    if (interceptMatch) {
        const marker = interceptMatch[1]!;
        const rest = interceptMatch[2]!;
        let level: InterceptLevel;
        if (marker === '(.)') {
            level = 'same';
        } else if (marker === '(...)') {
            level = 'root';
        } else {
            // One or more "(..)" groups concatenated — the count is the climb.
            level = (marker.match(/\(\.\.\)/g) || []).length;
        }
        return { ...parseSegment(rest), interceptLevel: level };
    }

    // Route group: (folder)
    if (segment.startsWith('(') && segment.endsWith(')')) {
        return {
            isDynamic: false,
            isCatchAll: false,
            isOptionalCatchAll: false,
            isGroup: true,
            routeSegment: '',
        };
    }

    // Optional catch-all: [[...param]]
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        const paramName = segment.slice(5, -2);
        return {
            isDynamic: true,
            isCatchAll: false,
            isOptionalCatchAll: true,
            isGroup: false,
            paramName,
            routeSegment: `*`,
        };
    }

    // Catch-all: [...param]
    if (segment.startsWith('[...') && segment.endsWith(']')) {
        const paramName = segment.slice(4, -1);
        return {
            isDynamic: true,
            isCatchAll: true,
            isOptionalCatchAll: false,
            isGroup: false,
            paramName,
            routeSegment: `*`,
        };
    }

    // Dynamic: [param]
    if (segment.startsWith('[') && segment.endsWith(']')) {
        const paramName = segment.slice(1, -1);
        return {
            isDynamic: true,
            isCatchAll: false,
            isOptionalCatchAll: false,
            isGroup: false,
            paramName,
            routeSegment: `:${paramName}`,
        };
    }

    // Static segment
    return {
        isDynamic: false,
        isCatchAll: false,
        isOptionalCatchAll: false,
        isGroup: false,
        routeSegment: segment,
    };
}

/**
 * Resolves an intercepting marker to the URL prefix it points at, given the
 * route ancestors leading to the marker's parent (excluding route groups).
 *
 *   `(.)`        — same level as the marker's parent
 *   `(..)`       — one route level above
 *   `(..)(..)`   — two route levels above
 *   `(...)`      — the app root
 */
function resolveInterceptBase(
    routeAncestors: string[],
    level: InterceptLevel
): string[] {
    if (level === 'root') return [];
    if (level === 'same') return [...routeAncestors];
    const climb = Math.min(level, routeAncestors.length);
    return routeAncestors.slice(0, routeAncestors.length - climb);
}

/**
 * Joins URL segments into an absolute pathname (always starts with `/`).
 */
function joinUrlSegments(segments: string[]): string {
    if (segments.length === 0) return '/';
    return '/' + segments.join('/');
}

interface ScanContext {
    /** Route segments (URL-form) leading to the current directory, excluding route groups */
    routeAncestors: string[];
    /** When inside an intercepting subtree, the source URL where interception originates */
    interceptSource?: string;
}

/**
 * Recursively scans the app directory and builds the route tree
 */
export function scanAppDirectory(
    dirPath: string,
    extensions: string[] = DEFAULT_EXTENSIONS,
    parentPath: string = '',
    ctx: ScanContext = { routeAncestors: [] }
): RouteNode[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const nodes: RouteNode[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Ignore directories starting with _ (private folders)
        if (entry.name.startsWith('_')) continue;

        // Ignore common directories that are not routes
        if (['node_modules', '.git', 'components', 'lib', 'utils', 'hooks', 'styles'].includes(entry.name)) {
            continue;
        }

        const segmentInfo = parseSegment(entry.name);
        const fullDirPath = path.join(dirPath, entry.name);

        // Entering a new intercepting subtree (only at the top of an intercept chain)
        if (segmentInfo.interceptLevel !== undefined && !ctx.interceptSource) {
            // The "parent" path (where this marker dir lives) is the source.
            const sourcePath = parentPath || '/';
            // Climb from the parent's route ancestors as required by the marker,
            // then append this marker dir's own segment to form the target base.
            const climbed = resolveInterceptBase(ctx.routeAncestors, segmentInfo.interceptLevel);
            const targetAncestors = segmentInfo.routeSegment
                ? [...climbed, segmentInfo.routeSegment]
                : climbed;
            const targetPath = joinUrlSegments(targetAncestors);

            const childCtx: ScanContext = {
                routeAncestors: targetAncestors,
                interceptSource: sourcePath,
            };

            const node: RouteNode = {
                segment: entry.name,
                path: targetPath,
                isDynamic: segmentInfo.isDynamic,
                isCatchAll: segmentInfo.isCatchAll,
                isOptionalCatchAll: segmentInfo.isOptionalCatchAll,
                isGroup: false,
                paramName: segmentInfo.paramName,
                isIntercepting: true,
                interceptSource: sourcePath,
                pagePath: findFileWithExtension(fullDirPath, 'page', extensions),
                // Layouts/loading/etc. inside an intercepting subtree are
                // intentionally ignored by the current renderer; the intercept
                // is rendered without target/source layouts (see codeGenerator).
                loadingPath: findFileWithExtension(fullDirPath, 'loading', extensions),
                errorPath: findFileWithExtension(fullDirPath, 'error', extensions),
                children: scanAppDirectory(fullDirPath, extensions, targetPath, childCtx),
            };

            nodes.push(node);
            continue;
        }

        // Calculate the route path
        const routePath = segmentInfo.isGroup
            ? parentPath
            : parentPath + (segmentInfo.routeSegment ? `/${segmentInfo.routeSegment}` : '');

        const childAncestors = segmentInfo.isGroup
            ? ctx.routeAncestors
            : segmentInfo.routeSegment
                ? [...ctx.routeAncestors, segmentInfo.routeSegment]
                : ctx.routeAncestors;

        const node: RouteNode = {
            segment: entry.name,
            path: routePath || '/',
            isDynamic: segmentInfo.isDynamic,
            isCatchAll: segmentInfo.isCatchAll,
            isOptionalCatchAll: segmentInfo.isOptionalCatchAll,
            isGroup: segmentInfo.isGroup,
            paramName: segmentInfo.paramName,
            isIntercepting: ctx.interceptSource !== undefined,
            interceptSource: ctx.interceptSource,
            pagePath: findFileWithExtension(fullDirPath, 'page', extensions),
            layoutPath: findFileWithExtension(fullDirPath, 'layout', extensions),
            loadingPath: findFileWithExtension(fullDirPath, 'loading', extensions),
            errorPath: findFileWithExtension(fullDirPath, 'error', extensions),
            notFoundPath: findFileWithExtension(fullDirPath, 'not-found', extensions),
            children: scanAppDirectory(fullDirPath, extensions, routePath, {
                routeAncestors: childAncestors,
                interceptSource: ctx.interceptSource,
            }),
        };

        nodes.push(node);
    }

    // Sort: static routes first, dynamic routes second, catch-all last
    return nodes.sort((a, b) => {
        if (a.isCatchAll || a.isOptionalCatchAll) return 1;
        if (b.isCatchAll || b.isOptionalCatchAll) return -1;
        if (a.isDynamic && !b.isDynamic) return 1;
        if (!a.isDynamic && b.isDynamic) return -1;
        return a.segment.localeCompare(b.segment);
    });
}

/**
 * Checks if there's a page.tsx in the app root
 */
export function getRootPage(
    appDir: string,
    extensions: string[] = DEFAULT_EXTENSIONS
): { pagePath?: string; layoutPath?: string; loadingPath?: string; errorPath?: string; notFoundPath?: string } {
    return {
        pagePath: findFileWithExtension(appDir, 'page', extensions),
        layoutPath: findFileWithExtension(appDir, 'layout', extensions),
        loadingPath: findFileWithExtension(appDir, 'loading', extensions),
        errorPath: findFileWithExtension(appDir, 'error', extensions),
        notFoundPath: findFileWithExtension(appDir, 'not-found', extensions),
    };
}

interface ParentContext {
    layouts: string[];
    loadingPath?: string;
    errorPath?: string;
    notFoundPath?: string;
    /** Map of layout path to its specific not-found component */
    layoutNotFoundMap: Map<string, string>;
}

export interface FlattenedRoutes {
    routes: ParsedRoute[];
    intercepts: InterceptedRoute[];
}

/**
 * Flattens the route tree into a list of parsed routes plus intercepts.
 * Intercepting subtrees are extracted into a separate list so that the
 * regular route table doesn't contain duplicates at the same URL.
 */
export function flattenRoutes(
    nodes: RouteNode[],
    parentContext: ParentContext = { layouts: [], layoutNotFoundMap: new Map() },
    rootContext?: { layoutPath?: string; loadingPath?: string; errorPath?: string; notFoundPath?: string }
): FlattenedRoutes {
    const routes: ParsedRoute[] = [];
    const intercepts: InterceptedRoute[] = [];

    // Merge root context with parent context
    const context: ParentContext = rootContext
        ? {
            layouts: rootContext.layoutPath ? [rootContext.layoutPath, ...parentContext.layouts] : parentContext.layouts,
            loadingPath: rootContext.loadingPath || parentContext.loadingPath,
            errorPath: rootContext.errorPath || parentContext.errorPath,
            notFoundPath: rootContext.notFoundPath || parentContext.notFoundPath,
            layoutNotFoundMap: new Map(parentContext.layoutNotFoundMap),
        }
        : parentContext;

    // If root has a layout and not-found, add to map
    if (rootContext?.layoutPath && rootContext?.notFoundPath) {
        context.layoutNotFoundMap.set(rootContext.layoutPath, rootContext.notFoundPath);
    }

    for (const node of nodes) {
        // Intercepting subtree: collect intercept entries from the page nodes
        // inside it, keyed by source/target. The source's loading is the only
        // contextual data we carry; layouts are intentionally not applied to
        // intercepts (the intercept page is rendered as a leaf overlay).
        if (node.isIntercepting && node.interceptSource !== undefined) {
            collectIntercepts(node, node.interceptSource, context.loadingPath, intercepts);
            continue;
        }

        // Build current context - child values override parent values
        const currentLayoutNotFoundMap = new Map(context.layoutNotFoundMap);

        // If this node has a layout and a not-found, add to map
        if (node.layoutPath && node.notFoundPath) {
            currentLayoutNotFoundMap.set(node.layoutPath, node.notFoundPath);
        }

        const currentContext: ParentContext = {
            layouts: node.layoutPath ? [...context.layouts, node.layoutPath] : context.layouts,
            loadingPath: node.loadingPath || context.loadingPath,
            errorPath: node.errorPath || context.errorPath,
            notFoundPath: node.notFoundPath || context.notFoundPath,
            layoutNotFoundMap: currentLayoutNotFoundMap,
        };

        // If the node has a page, add the route
        if (node.pagePath) {
            routes.push({
                pattern: node.path || '/',
                pagePath: node.pagePath,
                layouts: currentContext.layouts,
                loadingPath: currentContext.loadingPath,
                errorPath: currentContext.errorPath,
                notFoundPath: currentContext.notFoundPath,
                layoutNotFoundMap: new Map(currentContext.layoutNotFoundMap),
            });
        }

        // Process children recursively
        if (node.children.length > 0) {
            const childResult = flattenRoutes(node.children, currentContext);
            routes.push(...childResult.routes);
            intercepts.push(...childResult.intercepts);
        }
    }

    return { routes, intercepts };
}

/**
 * Walks an intercepting subtree and pushes one InterceptedRoute per page.
 */
function collectIntercepts(
    node: RouteNode,
    sourcePattern: string,
    inheritedLoading: string | undefined,
    out: InterceptedRoute[]
): void {
    const loadingPath = node.loadingPath || inheritedLoading;
    if (node.pagePath) {
        out.push({
            sourcePattern,
            targetPattern: node.path || '/',
            pagePath: node.pagePath,
            loadingPath,
        });
    }
    for (const child of node.children) {
        collectIntercepts(child, sourcePattern, loadingPath, out);
    }
}

/**
 * Converts the absolute path to a relative import path
 */
export function toImportPath(filePath: string, rootDir: string): string {
    const relativePath = path.relative(rootDir, filePath);
    // Normalize to forward slashes and remove extension
    const normalized = relativePath.replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/**
 * Generates a valid JavaScript identifier from a path
 */
export function pathToIdentifier(routePath: string): string {
    if (routePath === '/' || routePath === '') {
        return 'Root';
    }
    return routePath
        .replace(/^\//, '')
        .replace(/[/:*[\]]/g, '_')
        .replace(/_+/g, '_')
        .replace(/_$/, '')
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

/**
 * Complete parse of the app directory
 */
export function parseAppRouter(options: PluginOptions = {}): {
    routes: ParsedRoute[];
    intercepts: InterceptedRoute[];
    tree: RouteNode[];
    rootLayout?: string;
    rootPage?: string;
    rootNotFound?: string;
} {
    const appDir = options.appDir || 'src/app';
    const extensions = options.extensions || DEFAULT_EXTENSIONS;

    const tree = scanAppDirectory(appDir, extensions);
    const root = getRootPage(appDir, extensions);
    const { routes, intercepts } = flattenRoutes(
        tree,
        { layouts: [], layoutNotFoundMap: new Map() },
        root
    );

    // Build the root layoutNotFoundMap
    const rootLayoutNotFoundMap = new Map<string, string>();
    if (root.layoutPath && root.notFoundPath) {
        rootLayoutNotFoundMap.set(root.layoutPath, root.notFoundPath);
    }

    // Add the root route if it exists
    if (root.pagePath) {
        routes.unshift({
            pattern: '/',
            pagePath: root.pagePath,
            layouts: root.layoutPath ? [root.layoutPath] : [],
            loadingPath: root.loadingPath,
            errorPath: root.errorPath,
            notFoundPath: root.notFoundPath,
            layoutNotFoundMap: rootLayoutNotFoundMap,
        });
    }

    return {
        routes,
        intercepts,
        tree,
        rootLayout: root.layoutPath,
        rootPage: root.pagePath,
        rootNotFound: root.notFoundPath,
    };
}
