/**
 * Directory structure parser for routes
 * Follows Next.js App Router conventions
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RouteNode, ParsedRoute, PluginOptions } from './types.js';

const DEFAULT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

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

/**
 * Parses the segment name to extract dynamic route information
 */
function parseSegment(segment: string): {
    isDynamic: boolean;
    isCatchAll: boolean;
    isOptionalCatchAll: boolean;
    isGroup: boolean;
    paramName?: string;
    routeSegment: string;
} {
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
 * Recursively scans the app directory and builds the route tree
 */
export function scanAppDirectory(
    dirPath: string,
    extensions: string[] = DEFAULT_EXTENSIONS,
    parentPath: string = ''
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

        // Calculate the route path
        const routePath = segmentInfo.isGroup
            ? parentPath
            : parentPath + (segmentInfo.routeSegment ? `/${segmentInfo.routeSegment}` : '');

        const node: RouteNode = {
            segment: entry.name,
            path: routePath || '/',
            isDynamic: segmentInfo.isDynamic,
            isCatchAll: segmentInfo.isCatchAll,
            isOptionalCatchAll: segmentInfo.isOptionalCatchAll,
            isGroup: segmentInfo.isGroup,
            paramName: segmentInfo.paramName,
            pagePath: findFileWithExtension(fullDirPath, 'page', extensions),
            layoutPath: findFileWithExtension(fullDirPath, 'layout', extensions),
            loadingPath: findFileWithExtension(fullDirPath, 'loading', extensions),
            errorPath: findFileWithExtension(fullDirPath, 'error', extensions),
            notFoundPath: findFileWithExtension(fullDirPath, 'not-found', extensions),
            children: scanAppDirectory(fullDirPath, extensions, routePath),
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
}

/**
 * Flattens the route tree into a list of parsed routes
 */
export function flattenRoutes(
    nodes: RouteNode[],
    parentContext: ParentContext = { layouts: [] },
    rootContext?: { layoutPath?: string; loadingPath?: string; errorPath?: string; notFoundPath?: string }
): ParsedRoute[] {
    const routes: ParsedRoute[] = [];

    // Merge root context with parent context
    const context: ParentContext = rootContext
        ? {
            layouts: rootContext.layoutPath ? [rootContext.layoutPath, ...parentContext.layouts] : parentContext.layouts,
            loadingPath: rootContext.loadingPath || parentContext.loadingPath,
            errorPath: rootContext.errorPath || parentContext.errorPath,
            notFoundPath: rootContext.notFoundPath || parentContext.notFoundPath,
        }
        : parentContext;

    for (const node of nodes) {
        // Build current context - child values override parent values
        const currentContext: ParentContext = {
            layouts: node.layoutPath ? [...context.layouts, node.layoutPath] : context.layouts,
            loadingPath: node.loadingPath || context.loadingPath,
            errorPath: node.errorPath || context.errorPath,
            notFoundPath: node.notFoundPath || context.notFoundPath,
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
            });
        }

        // Process children recursively
        if (node.children.length > 0) {
            routes.push(...flattenRoutes(node.children, currentContext));
        }
    }

    return routes;
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
    tree: RouteNode[];
    rootLayout?: string;
    rootPage?: string;
    rootNotFound?: string;
} {
    const appDir = options.appDir || 'src/app';
    const extensions = options.extensions || DEFAULT_EXTENSIONS;

    const tree = scanAppDirectory(appDir, extensions);
    const root = getRootPage(appDir, extensions);
    const routes = flattenRoutes(tree, { layouts: [] }, root);

    // Add the root route if it exists
    if (root.pagePath) {
        routes.unshift({
            pattern: '/',
            pagePath: root.pagePath,
            layouts: root.layoutPath ? [root.layoutPath] : [],
            loadingPath: root.loadingPath,
            errorPath: root.errorPath,
            notFoundPath: root.notFoundPath,
        });
    }

    return {
        routes,
        tree,
        rootLayout: root.layoutPath,
        rootPage: root.pagePath,
        rootNotFound: root.notFoundPath,
    };
}
