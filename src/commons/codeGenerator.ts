/**
 * Code generator for react-router-dom using AST
 * Generates the virtual module code that exports routes
 *
 * Uses nested routes for layouts, enabling efficient SPA navigation
 */

import * as t from '@babel/types';
import _generate from '@babel/generator';
import type { ParsedRoute, InterceptedRoute, RouteNode } from './types.js';
import { pathToIdentifier } from './routeParser.js';

/** State key on history.state used to signal an intercepted navigation. */
const BACKGROUND_LOCATION_KEY = 'appRouterBackgroundLocation';
/** Internal name for the resolver function in the generated module. */
const INTERCEPT_RESOLVER_NAME = '__appRouterInterceptResolver__';

// Handle both ESM and CJS default exports
const generate = typeof _generate === 'function' ? _generate : (_generate as { default: typeof _generate }).default;

/**
 * Normalizes the path for import (converts backslashes and removes extension)
 */
function normalizeImportPath(filePath: string, rootDir: string): string {
    let relativePath = filePath;

    if (filePath.startsWith(rootDir)) {
        relativePath = filePath.slice(rootDir.length);
    }

    return relativePath
        .replace(/\\/g, '/')
        .replace(/\.(tsx?|jsx?)$/, '')
        .replace(/^\//, '');
}

/**
 * Generates a unique import name based on the path
 */
function generateImportName(prefix: string, filePath: string, index: number): string {
    const safePath = pathToIdentifier(filePath);
    return `${prefix}${safePath || index}`;
}

/**
 * Creates an import declaration AST node
 */
function createImportDeclaration(
    specifiers: t.ImportSpecifier[] | t.ImportDefaultSpecifier[],
    source: string
): t.ImportDeclaration {
    return t.importDeclaration(specifiers, t.stringLiteral(source));
}

/**
 * Creates a named import specifier
 */
function createNamedImport(name: string): t.ImportSpecifier {
    const id = t.identifier(name);
    return t.importSpecifier(id, id);
}

/**
 * Creates a default import specifier
 */
function createDefaultImport(name: string): t.ImportDefaultSpecifier {
    return t.importDefaultSpecifier(t.identifier(name));
}

/**
 * Creates a lazy import variable declaration
 * const ComponentName = lazy(() => import('/path'));
 */
function createLazyImport(name: string, path: string): t.VariableDeclaration {
    return t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier(name),
            t.callExpression(t.identifier('lazy'), [
                t.arrowFunctionExpression(
                    [],
                    t.callExpression(t.identifier('import'), [t.stringLiteral(`/${path}`)])
                ),
            ])
        ),
    ]);
}

/**
 * Creates a createElement call expression
 * @param component - Component identifier (like 'Suspense') or string literal for HTML elements (like 'div')
 * @param isStringLiteral - If true, component is treated as a string literal (for HTML elements)
 */
function createCreateElementCallExpression(
    component: string,
    props: t.ObjectExpression | t.NullLiteral,
    children: t.Expression[],
    isStringLiteral = false
): t.CallExpression {
    const componentNode = isStringLiteral ? t.stringLiteral(component) : t.identifier(component);
    const args: t.Expression[] = [componentNode, props, ...children];
    return t.callExpression(t.identifier('createElement'), args);
}

/**
 * Creates a Suspense wrapper with createElement
 * @param componentName - The component to wrap
 * @param lazy - Whether lazy loading is enabled
 * @param loadingComponentName - Optional custom loading component name
 */
function createSuspenseWrapper(
    componentName: string,
    lazy: boolean,
    loadingComponentName?: string
): t.CallExpression {
    // If a custom loading component is provided, use it; otherwise use a simple div
    const fallback = loadingComponentName
        ? createCreateElementCallExpression(loadingComponentName, t.nullLiteral(), [])
        : createCreateElementCallExpression('div', t.nullLiteral(), [t.stringLiteral('Loading...')], true);

    if (lazy) {
        return createCreateElementCallExpression(
            'Suspense',
            t.objectExpression([t.objectProperty(t.identifier('fallback'), fallback)]),
            [createCreateElementCallExpression(componentName, t.nullLiteral(), [])]
        );
    }
    return createCreateElementCallExpression(componentName, t.nullLiteral(), []);
}

/**
 * Creates a route object expression
 */
function createRouteObject(properties: t.ObjectProperty[]): t.ObjectExpression {
    return t.objectExpression(properties);
}

/**
 * Creates a route property
 */
function createRouteProperty(
    key: string,
    value: t.Expression | boolean
): t.ObjectProperty {
    const valueNode = typeof value === 'boolean' ? t.booleanLiteral(value) : value;
    return t.objectProperty(t.identifier(key), valueNode);
}

interface CollectedImports {
    statements: t.Statement[];
    componentMap: Map<string, string>;
    layoutMap: Map<string, string>;
    loadingMap: Map<string, string>;
    errorMap: Map<string, string>;
    notFoundMap: Map<string, string>;
    /** Map of intercept page path → component name */
    interceptMap: Map<string, string>;
}

/**
 * Collects all necessary imports as AST nodes
 */
function collectImports(
    routes: ParsedRoute[],
    rootDir: string,
    lazy: boolean,
    rootNotFound?: string,
    intercepts: InterceptedRoute[] = []
): CollectedImports {
    const statements: t.Statement[] = [];
    const componentMap = new Map<string, string>();
    const layoutMap = new Map<string, string>();
    const loadingMap = new Map<string, string>();
    const errorMap = new Map<string, string>();
    const notFoundMap = new Map<string, string>();
    const interceptMap = new Map<string, string>();

    let pageIndex = 0;
    let layoutIndex = 0;
    let loadingIndex = 0;
    let errorIndex = 0;
    let notFoundIndex = 0;
    let interceptIndex = 0;
    const seenLayouts = new Set<string>();
    const seenLoading = new Set<string>();
    const seenError = new Set<string>();
    const seenNotFound = new Set<string>();
    const seenIntercepts = new Set<string>();

    const hasIntercepts = intercepts.length > 0;

    // Import from react-router-dom (add useLocation/matchPath when intercepts exist)
    const rrSpecifiers: t.ImportSpecifier[] = [
        createNamedImport('createBrowserRouter'),
        createNamedImport('RouterProvider'),
        createNamedImport('Outlet'),
    ];
    if (hasIntercepts) {
        rrSpecifiers.push(createNamedImport('useLocation'));
        rrSpecifiers.push(createNamedImport('matchPath'));
    }
    statements.push(createImportDeclaration(rrSpecifiers, 'react-router-dom'));

    // Import from react
    const reactImports: t.ImportSpecifier[] = [
        createNamedImport('Suspense'),
        createNamedImport('createElement'),
    ];
    if (lazy) {
        reactImports.unshift(createNamedImport('lazy'));
    }
    statements.push(
        t.importDeclaration(
            [t.importDefaultSpecifier(t.identifier('React')), ...reactImports],
            t.stringLiteral('react')
        )
    );

    for (const route of routes) {
        // Page import
        const pageName = `Page${generateImportName('', route.pattern, pageIndex++)}`;
        const pageImportPath = normalizeImportPath(route.pagePath, rootDir);

        if (lazy) {
            statements.push(createLazyImport(pageName, pageImportPath));
        } else {
            statements.push(
                createImportDeclaration([createDefaultImport(pageName)], `/${pageImportPath}`)
            );
        }
        componentMap.set(route.pagePath, pageName);

        // Layout imports
        for (const layoutPath of route.layouts) {
            if (!seenLayouts.has(layoutPath)) {
                seenLayouts.add(layoutPath);
                const layoutName = `Layout${layoutIndex++}`;
                const layoutImportPath = normalizeImportPath(layoutPath, rootDir);

                if (lazy) {
                    statements.push(createLazyImport(layoutName, layoutImportPath));
                } else {
                    statements.push(
                        createImportDeclaration([createDefaultImport(layoutName)], `/${layoutImportPath}`)
                    );
                }
                layoutMap.set(layoutPath, layoutName);
            }
        }

        // Loading component import
        if (route.loadingPath && !seenLoading.has(route.loadingPath)) {
            seenLoading.add(route.loadingPath);
            const loadingName = `Loading${loadingIndex++}`;
            const loadingImportPath = normalizeImportPath(route.loadingPath, rootDir);

            if (lazy) {
                statements.push(createLazyImport(loadingName, loadingImportPath));
            } else {
                statements.push(
                    createImportDeclaration([createDefaultImport(loadingName)], `/${loadingImportPath}`)
                );
            }
            loadingMap.set(route.loadingPath, loadingName);
        }

        // Error component import
        if (route.errorPath && !seenError.has(route.errorPath)) {
            seenError.add(route.errorPath);
            const errorName = `ErrorBoundary${errorIndex++}`;
            const errorImportPath = normalizeImportPath(route.errorPath, rootDir);

            if (lazy) {
                statements.push(createLazyImport(errorName, errorImportPath));
            } else {
                statements.push(
                    createImportDeclaration([createDefaultImport(errorName)], `/${errorImportPath}`)
                );
            }
            errorMap.set(route.errorPath, errorName);
        }

        // Not found component import
        if (route.notFoundPath && !seenNotFound.has(route.notFoundPath)) {
            seenNotFound.add(route.notFoundPath);
            const notFoundName = `NotFound${notFoundIndex++}`;
            const notFoundImportPath = normalizeImportPath(route.notFoundPath, rootDir);

            if (lazy) {
                statements.push(createLazyImport(notFoundName, notFoundImportPath));
            } else {
                statements.push(
                    createImportDeclaration([createDefaultImport(notFoundName)], `/${notFoundImportPath}`)
                );
            }
            notFoundMap.set(route.notFoundPath, notFoundName);
        }

        // Import all not-found components from layoutNotFoundMap
        if (route.layoutNotFoundMap) {
            for (const [, notFoundPath] of route.layoutNotFoundMap) {
                if (!seenNotFound.has(notFoundPath)) {
                    seenNotFound.add(notFoundPath);
                    const notFoundName = `NotFound${notFoundIndex++}`;
                    const notFoundImportPath = normalizeImportPath(notFoundPath, rootDir);

                    if (lazy) {
                        statements.push(createLazyImport(notFoundName, notFoundImportPath));
                    } else {
                        statements.push(
                            createImportDeclaration([createDefaultImport(notFoundName)], `/${notFoundImportPath}`)
                        );
                    }
                    notFoundMap.set(notFoundPath, notFoundName);
                }
            }
        }
    }

    // Import root not-found if provided and not already imported
    if (rootNotFound && !seenNotFound.has(rootNotFound)) {
        const notFoundName = `NotFound${notFoundIndex++}`;
        const notFoundImportPath = normalizeImportPath(rootNotFound, rootDir);

        if (lazy) {
            statements.push(createLazyImport(notFoundName, notFoundImportPath));
        } else {
            statements.push(
                createImportDeclaration([createDefaultImport(notFoundName)], `/${notFoundImportPath}`)
            );
        }
        notFoundMap.set(rootNotFound, notFoundName);
    }

    // Import intercept page components
    for (const ic of intercepts) {
        if (seenIntercepts.has(ic.pagePath)) continue;
        seenIntercepts.add(ic.pagePath);
        const name = `Intercept${interceptIndex++}`;
        const importPath = normalizeImportPath(ic.pagePath, rootDir);
        if (lazy) {
            statements.push(createLazyImport(name, importPath));
        } else {
            statements.push(
                createImportDeclaration([createDefaultImport(name)], `/${importPath}`)
            );
        }
        interceptMap.set(ic.pagePath, name);

        // Source loading components ride on top of regular loading imports.
        if (ic.loadingPath && !seenLoading.has(ic.loadingPath)) {
            seenLoading.add(ic.loadingPath);
            const loadingName = `Loading${loadingIndex++}`;
            const loadingImportPath = normalizeImportPath(ic.loadingPath, rootDir);
            if (lazy) {
                statements.push(createLazyImport(loadingName, loadingImportPath));
            } else {
                statements.push(
                    createImportDeclaration([createDefaultImport(loadingName)], `/${loadingImportPath}`)
                );
            }
            loadingMap.set(ic.loadingPath, loadingName);
        }
    }

    return { statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap, interceptMap };
}

/**
 * Builds the AST for the intercept resolver function:
 *
 *   function __appRouterInterceptResolver__({ regular, intercepts }) {
 *       const location = useLocation();
 *       const state = location.state;
 *       const bg = state && state.appRouterBackgroundLocation;
 *       if (bg && bg.pathname && intercepts) {
 *           for (let i = 0; i < intercepts.length; i++) {
 *               const ic = intercepts[i];
 *               if (matchPath({ path: ic.source, end: false }, bg.pathname)) {
 *                   return ic.element;
 *               }
 *           }
 *       }
 *       return regular;
 *   }
 */
function createInterceptResolverDeclaration(): t.FunctionDeclaration {
    const propsParam = t.objectPattern([
        t.objectProperty(t.identifier('regular'), t.identifier('regular'), false, true),
        t.objectProperty(t.identifier('intercepts'), t.identifier('intercepts'), false, true),
    ]);

    const locationDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('location'),
            t.callExpression(t.identifier('useLocation'), [])
        ),
    ]);

    const stateDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('state'),
            t.memberExpression(t.identifier('location'), t.identifier('state'))
        ),
    ]);

    const bgDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('bg'),
            t.logicalExpression(
                '&&',
                t.identifier('state'),
                t.memberExpression(t.identifier('state'), t.identifier(BACKGROUND_LOCATION_KEY))
            )
        ),
    ]);

    // matchPath({ path: ic.source, end: false }, bg.pathname)
    const matchCall = t.callExpression(t.identifier('matchPath'), [
        t.objectExpression([
            t.objectProperty(
                t.identifier('path'),
                t.memberExpression(t.identifier('ic'), t.identifier('source'))
            ),
            t.objectProperty(t.identifier('end'), t.booleanLiteral(false)),
        ]),
        t.memberExpression(t.identifier('bg'), t.identifier('pathname')),
    ]);

    const loopBody = t.blockStatement([
        t.variableDeclaration('const', [
            t.variableDeclarator(
                t.identifier('ic'),
                t.memberExpression(
                    t.identifier('intercepts'),
                    t.identifier('i'),
                    true
                )
            ),
        ]),
        t.ifStatement(
            matchCall,
            t.blockStatement([
                t.returnStatement(
                    t.memberExpression(t.identifier('ic'), t.identifier('element'))
                ),
            ])
        ),
    ]);

    const forStmt = t.forStatement(
        t.variableDeclaration('let', [
            t.variableDeclarator(t.identifier('i'), t.numericLiteral(0)),
        ]),
        t.binaryExpression(
            '<',
            t.identifier('i'),
            t.memberExpression(t.identifier('intercepts'), t.identifier('length'))
        ),
        t.updateExpression('++', t.identifier('i')),
        loopBody
    );

    const guard = t.ifStatement(
        t.logicalExpression(
            '&&',
            t.logicalExpression(
                '&&',
                t.identifier('bg'),
                t.memberExpression(t.identifier('bg'), t.identifier('pathname'))
            ),
            t.identifier('intercepts')
        ),
        t.blockStatement([forStmt])
    );

    const body = t.blockStatement([
        locationDecl,
        stateDecl,
        bgDecl,
        guard,
        t.returnStatement(t.identifier('regular')),
    ]);

    return t.functionDeclaration(
        t.identifier(INTERCEPT_RESOLVER_NAME),
        [propsParam],
        body
    );
}

/**
 * Wraps a route element in the intercept resolver:
 *
 *   createElement(__appRouterInterceptResolver__, {
 *       regular: <regular element>,
 *       intercepts: [
 *           { source: '/feed', element: createElement(InterceptN) },
 *           ...
 *       ]
 *   })
 */
function wrapWithInterceptResolver(
    regularElement: t.Expression,
    targetIntercepts: InterceptedRoute[],
    interceptMap: Map<string, string>,
    loadingMap: Map<string, string>,
    lazy: boolean
): t.CallExpression {
    const interceptObjects = targetIntercepts.map((ic) => {
        const componentName = interceptMap.get(ic.pagePath)!;
        const loadingName = ic.loadingPath ? loadingMap.get(ic.loadingPath) : undefined;
        return t.objectExpression([
            t.objectProperty(t.identifier('source'), t.stringLiteral(ic.sourcePattern)),
            t.objectProperty(
                t.identifier('element'),
                createSuspenseWrapper(componentName, lazy, loadingName)
            ),
        ]);
    });

    return t.callExpression(t.identifier('createElement'), [
        t.identifier(INTERCEPT_RESOLVER_NAME),
        t.objectExpression([
            t.objectProperty(t.identifier('regular'), regularElement),
            t.objectProperty(
                t.identifier('intercepts'),
                t.arrayExpression(interceptObjects)
            ),
        ]),
    ]);
}

/**
 * Builds a nested route structure for a single route
 */
function buildRouteExpression(
    route: ParsedRoute,
    componentMap: Map<string, string>,
    layoutMap: Map<string, string>,
    loadingMap: Map<string, string>,
    errorMap: Map<string, string>,
    notFoundMap: Map<string, string>,
    interceptMap: Map<string, string>,
    interceptsByTarget: Map<string, InterceptedRoute[]>,
    lazy: boolean
): t.ObjectExpression {
    const pageName = componentMap.get(route.pagePath)!;
    const isIndex = route.pattern === '/';
    const path = isIndex ? '' : route.pattern.replace(/^\//, '');

    // Get loading and error component names if available
    const loadingName = route.loadingPath ? loadingMap.get(route.loadingPath) : undefined;
    const errorName = route.errorPath ? errorMap.get(route.errorPath) : undefined;

    let pageElement: t.Expression = createSuspenseWrapper(pageName, lazy, loadingName);

    // If this target has any intercepts, wrap the element in the resolver.
    const targetIntercepts = interceptsByTarget.get(route.pattern);
    if (targetIntercepts && targetIntercepts.length > 0) {
        pageElement = wrapWithInterceptResolver(
            pageElement,
            targetIntercepts,
            interceptMap,
            loadingMap,
            lazy
        );
    }

    // Build the base route properties
    const buildRouteProps = (props: t.ObjectProperty[]): t.ObjectExpression => {
        // Add errorElement if error component exists
        if (errorName) {
            props.push(
                createRouteProperty('errorElement', createCreateElementCallExpression(errorName, t.nullLiteral(), []))
            );
        }
        return createRouteObject(props);
    };

    // Helper to get the not-found component name for a layout
    const getLayoutNotFoundName = (layoutPath: string): string | undefined => {
        if (!route.layoutNotFoundMap) return undefined;
        const notFoundPath = route.layoutNotFoundMap.get(layoutPath);
        return notFoundPath ? notFoundMap.get(notFoundPath) : undefined;
    };

    // If there are inner layouts (more than just root), create nested structure
    if (route.layouts.length > 1) {
        // Build from innermost to outermost (excluding root layout)
        let innerRoute: t.ObjectExpression = isIndex
            ? buildRouteProps([
                createRouteProperty('index', true),
                createRouteProperty('element', pageElement),
            ])
            : buildRouteProps([
                createRouteProperty('path', t.stringLiteral(path)),
                createRouteProperty('element', pageElement),
            ]);

        // Wrap with inner layouts (from innermost to outermost, excluding root)
        for (let i = route.layouts.length - 1; i >= 1; i--) {
            const layoutPath = route.layouts[i]!;
            const innerLayoutName = layoutMap.get(layoutPath)!;
            const layoutNotFoundName = getLayoutNotFoundName(layoutPath);

            // Build children array with the inner route
            const childrenRoutes: t.ObjectExpression[] = [innerRoute];

            // Add catch-all not-found route for this layout if it has one
            if (layoutNotFoundName) {
                childrenRoutes.push(
                    createRouteObject([
                        createRouteProperty('path', t.stringLiteral('*')),
                        createRouteProperty('element', createSuspenseWrapper(layoutNotFoundName, lazy)),
                    ])
                );
            }

            innerRoute = createRouteObject([
                createRouteProperty('element', createSuspenseWrapper(innerLayoutName, lazy, loadingName)),
                createRouteProperty('children', t.arrayExpression(childrenRoutes)),
            ]);
        }

        return innerRoute;
    }

    // Simple route without nested layouts
    if (isIndex) {
        return buildRouteProps([
            createRouteProperty('index', true),
            createRouteProperty('element', pageElement),
        ]);
    }

    return buildRouteProps([
        createRouteProperty('path', t.stringLiteral(path)),
        createRouteProperty('element', pageElement),
    ]);
}

export interface CodeGeneratorOptions {
    /** Project root directory (for relative imports) */
    rootDir: string;
    /** Whether to use lazy loading */
    lazy?: boolean;
    /** Root not-found component path */
    rootNotFound?: string;
    /** Intercepting routes (Next.js (.) / (..) / (...) convention) */
    intercepts?: InterceptedRoute[];
    /**
     * The full route tree (children of the app dir). When supplied, the
     * generator builds the route definitions recursively so that error and
     * not-found boundaries land at the segment where they were declared,
     * matching Next.js semantics. Falls back to the legacy flat layout when
     * omitted (kept for backward compatibility).
     */
    tree?: RouteNode[];
    /** Root layout absolute path */
    rootLayout?: string;
    /** Root page absolute path */
    rootPage?: string;
    /** Root error.tsx absolute path */
    rootError?: string;
    /** Root loading.tsx absolute path */
    rootLoading?: string;
}

/**
 * Builder context shared across recursive calls to buildSubtree.
 */
interface BuilderCtx {
    componentMap: Map<string, string>;
    layoutMap: Map<string, string>;
    loadingMap: Map<string, string>;
    errorMap: Map<string, string>;
    notFoundMap: Map<string, string>;
    interceptMap: Map<string, string>;
    interceptsByTarget: Map<string, InterceptedRoute[]>;
    lazy: boolean;
}

/**
 * Resolves the loading component name to use for a node, walking up the
 * inherited loading chain.
 */
function pickLoading(
    nodeLoading: string | undefined,
    inheritedLoading: string | undefined,
    ctx: BuilderCtx
): string | undefined {
    const path = nodeLoading || inheritedLoading;
    return path ? ctx.loadingMap.get(path) : undefined;
}

/**
 * Builds the page route node for a given segment. Pattern is taken from
 * `node.path`, which is already absolute-relative-to-root (e.g. "dashboard/x").
 *
 * When the page sits inside a layout we emit `index: true` for the segment
 * that shares the layout's URL — this is the canonical react-router way to
 * mark "this is the default child of the layout". Without a wrapping layout
 * we fall back to an explicit `path: '/'` (or the original pattern).
 */
function makePageNode(
    node: { path: string; pagePath: string },
    inheritedLoading: string | undefined,
    ctx: BuilderCtx,
    insideLayout: boolean
): t.ObjectExpression {
    const pageName = ctx.componentMap.get(node.pagePath)!;
    const loadingName = pickLoading(undefined, inheritedLoading, ctx);
    const isRootPath = node.path === '/' || node.path === '';
    const useIndex = insideLayout && isRootPath;
    const path = isRootPath ? '/' : node.path.replace(/^\//, '');

    let pageElement: t.Expression = createSuspenseWrapper(pageName, ctx.lazy, loadingName);
    const targetIntercepts = ctx.interceptsByTarget.get(node.path);
    if (targetIntercepts && targetIntercepts.length > 0) {
        pageElement = wrapWithInterceptResolver(
            pageElement,
            targetIntercepts,
            ctx.interceptMap,
            ctx.loadingMap,
            ctx.lazy
        );
    }

    if (useIndex) {
        return createRouteObject([
            createRouteProperty('index', true),
            createRouteProperty('element', pageElement),
        ]);
    }
    return createRouteObject([
        createRouteProperty('path', t.stringLiteral(path)),
        createRouteProperty('element', pageElement),
    ]);
}

/**
 * Wraps a list of children in an Outlet with `errorElement`, so the error
 * boundary captures errors thrown anywhere underneath while renderering at
 * the parent layout's <Outlet/>. Mirrors Next.js's per-segment error.tsx
 * boundary, which is nested *inside* the layout of the same segment.
 */
function makeErrorWrapper(
    errorPath: string,
    children: t.ObjectExpression[],
    ctx: BuilderCtx
): t.ObjectExpression {
    const errorName = ctx.errorMap.get(errorPath)!;
    return createRouteObject([
        createRouteProperty(
            'element',
            createCreateElementCallExpression('Outlet', t.nullLiteral(), [])
        ),
        createRouteProperty(
            'errorElement',
            createCreateElementCallExpression(errorName, t.nullLiteral(), [])
        ),
        createRouteProperty('children', t.arrayExpression(children)),
    ]);
}

/**
 * Wraps a list of children in a layout node. Root layout gets `path: '/'`.
 */
function makeLayoutNode(
    layoutPath: string,
    inheritedLoading: string | undefined,
    children: t.ObjectExpression[],
    ctx: BuilderCtx,
    isRoot: boolean
): t.ObjectExpression {
    const layoutName = ctx.layoutMap.get(layoutPath)!;
    const loadingName = pickLoading(undefined, inheritedLoading, ctx);
    const props: t.ObjectProperty[] = [];
    if (isRoot) {
        props.push(createRouteProperty('path', t.stringLiteral('/')));
    }
    props.push(
        createRouteProperty('element', createSuspenseWrapper(layoutName, ctx.lazy, loadingName))
    );
    props.push(createRouteProperty('children', t.arrayExpression(children)));
    return createRouteObject(props);
}

/**
 * Recursively builds the react-router children for a single RouteNode.
 *
 * Each segment may contribute (in this order, when present):
 *   1. A page node (its own page.tsx).
 *   2. Subtrees from descendant segments.
 *   3. A catch-all not-found node when this segment pairs `layout.tsx` with
 *      `not-found.tsx`.
 *
 * If the segment has its own error.tsx, the accumulated children are wrapped
 * in an Outlet+errorElement boundary so the boundary lands inside the layout
 * of the same segment (matching Next.js).
 *
 * If the segment has its own layout.tsx, the result becomes a single layout
 * node; otherwise the children are returned as a flat list to be spread in
 * the parent.
 */
function buildSubtree(
    node: RouteNode,
    inheritedLoading: string | undefined,
    ctx: BuilderCtx,
    isRoot: boolean = false,
    insideLayout: boolean = false
): t.ObjectExpression[] {
    // Intercepting subtrees are handled separately via interceptsByTarget;
    // they do not contribute to the regular route table.
    if (node.isIntercepting) return [];

    const localLoading = node.loadingPath || inheritedLoading;

    // Anything we emit as a child of `node` is, in the final react-router
    // tree, inside a layout iff `node` itself wraps in one OR we already are
    // inside an ancestor's layout.
    const childrenInsideLayout = insideLayout || !!node.layoutPath;

    const inner: t.ObjectExpression[] = [];

    if (node.pagePath) {
        inner.push(
            makePageNode(
                { path: node.path, pagePath: node.pagePath },
                localLoading,
                ctx,
                childrenInsideLayout
            )
        );
    }

    // Route groups don't contribute their own segment but still emit pages.
    // Their children iterate normally below.
    for (const child of node.children) {
        inner.push(...buildSubtree(child, localLoading, ctx, false, childrenInsideLayout));
    }

    // not-found catch-all paired with this segment's layout
    if (node.layoutPath && node.notFoundPath) {
        const notFoundName = ctx.notFoundMap.get(node.notFoundPath);
        if (notFoundName) {
            inner.push(
                createRouteObject([
                    createRouteProperty('path', t.stringLiteral('*')),
                    createRouteProperty(
                        'element',
                        createSuspenseWrapper(notFoundName, ctx.lazy)
                    ),
                ])
            );
        }
    }

    let wrapped: t.ObjectExpression[] = inner;

    // error.tsx of this segment wraps everything underneath, but is itself
    // rendered *inside* the layout of the same segment.
    if (node.errorPath) {
        wrapped = [makeErrorWrapper(node.errorPath, wrapped, ctx)];
    }

    if (node.layoutPath) {
        return [makeLayoutNode(node.layoutPath, inheritedLoading, wrapped, ctx, isRoot)];
    }

    // No layout: pass children up. The error wrapper (if any) becomes a
    // pathless sibling at the parent level, capturing only the routes from
    // this subtree.
    return wrapped;
}

/**
 * Walks the tree (plus root info) collecting absolute paths that must be
 * imported as components.
 */
interface CollectedPaths {
    pages: string[];
    layouts: string[];
    loadings: string[];
    errors: string[];
    notFounds: string[];
}

function collectPathsFromTree(
    tree: RouteNode[],
    rootInfo: { layoutPath?: string; pagePath?: string; loadingPath?: string; errorPath?: string; notFoundPath?: string }
): CollectedPaths {
    const pages: string[] = [];
    const layouts: string[] = [];
    const loadings: string[] = [];
    const errors: string[] = [];
    const notFounds: string[] = [];

    if (rootInfo.pagePath) pages.push(rootInfo.pagePath);
    if (rootInfo.layoutPath) layouts.push(rootInfo.layoutPath);
    if (rootInfo.loadingPath) loadings.push(rootInfo.loadingPath);
    if (rootInfo.errorPath) errors.push(rootInfo.errorPath);
    if (rootInfo.notFoundPath) notFounds.push(rootInfo.notFoundPath);

    function walk(node: RouteNode): void {
        if (node.isIntercepting) return;
        if (node.pagePath) pages.push(node.pagePath);
        if (node.layoutPath) layouts.push(node.layoutPath);
        if (node.loadingPath) loadings.push(node.loadingPath);
        if (node.errorPath) errors.push(node.errorPath);
        if (node.notFoundPath) notFounds.push(node.notFoundPath);
        for (const c of node.children) walk(c);
    }
    for (const n of tree) walk(n);

    return { pages, layouts, loadings, errors, notFounds };
}

/**
 * Builds the import statements + maps from a path-collection. Used by the
 * tree-based code path (the legacy route-based path keeps using `collectImports`).
 */
function collectImportsFromPaths(
    paths: CollectedPaths,
    rootDir: string,
    lazy: boolean,
    intercepts: InterceptedRoute[]
): {
    statements: t.Statement[];
    componentMap: Map<string, string>;
    layoutMap: Map<string, string>;
    loadingMap: Map<string, string>;
    errorMap: Map<string, string>;
    notFoundMap: Map<string, string>;
    interceptMap: Map<string, string>;
} {
    const statements: t.Statement[] = [];
    const componentMap = new Map<string, string>();
    const layoutMap = new Map<string, string>();
    const loadingMap = new Map<string, string>();
    const errorMap = new Map<string, string>();
    const notFoundMap = new Map<string, string>();
    const interceptMap = new Map<string, string>();

    const hasIntercepts = intercepts.length > 0;

    const rrSpecifiers: t.ImportSpecifier[] = [
        createNamedImport('createBrowserRouter'),
        createNamedImport('RouterProvider'),
        createNamedImport('Outlet'),
    ];
    if (hasIntercepts) {
        rrSpecifiers.push(createNamedImport('useLocation'));
        rrSpecifiers.push(createNamedImport('matchPath'));
    }
    statements.push(createImportDeclaration(rrSpecifiers, 'react-router-dom'));

    const reactSpecifiers: t.ImportSpecifier[] = [
        createNamedImport('Suspense'),
        createNamedImport('createElement'),
    ];
    if (lazy) reactSpecifiers.unshift(createNamedImport('lazy'));
    statements.push(
        t.importDeclaration(
            [t.importDefaultSpecifier(t.identifier('React')), ...reactSpecifiers],
            t.stringLiteral('react')
        )
    );

    function safeIdent(absPath: string): string {
        // pathToIdentifier was originally written for URL patterns and only
        // strips `/`, `:`, `*`, `[`, `]`. Filesystem paths can carry `\` (on
        // Windows), `(`, `)` (route groups), `.` (extensions), `@` (parallel
        // slots), etc. Strip everything that isn't a JS identifier character
        // before handing it off so we always produce a valid identifier.
        const importPath = normalizeImportPath(absPath, rootDir)
            .replace(/[^A-Za-z0-9]/g, '_');
        return pathToIdentifier(importPath);
    }

    function emit(prefix: string, kind: Map<string, string>, paths: string[]): void {
        let i = 0;
        const seen = new Set<string>();
        for (const p of paths) {
            if (seen.has(p)) continue;
            seen.add(p);
            const safe = safeIdent(p);
            const name = `${prefix}${safe || i++}`;
            const importPath = normalizeImportPath(p, rootDir);
            if (lazy) {
                statements.push(createLazyImport(name, importPath));
            } else {
                statements.push(
                    createImportDeclaration([createDefaultImport(name)], `/${importPath}`)
                );
            }
            kind.set(p, name);
        }
    }

    emit('Page', componentMap, paths.pages);
    emit('Layout', layoutMap, paths.layouts);
    emit('Loading', loadingMap, paths.loadings);
    emit('ErrorBoundary', errorMap, paths.errors);
    emit('NotFound', notFoundMap, paths.notFounds);
    emit('Intercept', interceptMap, intercepts.map((ic) => ic.pagePath));

    // Source loadings of intercepts (in addition to regular ones)
    const extraLoadings = intercepts
        .map((ic) => ic.loadingPath)
        .filter((p): p is string => Boolean(p) && !loadingMap.has(p as string));
    if (extraLoadings.length) {
        emit('Loading', loadingMap, extraLoadings);
    }

    return { statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap, interceptMap };
}

/**
 * Generates the complete routes module AST
 */
function generateRoutesAST(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): t.Program {
    const {
        rootDir,
        lazy = true,
        rootNotFound,
        intercepts = [],
        tree,
        rootLayout,
        rootPage,
        rootError,
        rootLoading,
    } = options;

    if (routes.length === 0) {
        return generateEmptyRoutesAST();
    }

    // Drop intercepts whose target route doesn't exist — without a regular sibling
    // route there is no element to wrap, and the URL would not be reachable at all
    // with the current renderer (a future iteration could synthesize a standalone
    // route, but that hides the misconfiguration from the developer).
    const targetPatterns = new Set(routes.map((r) => r.pattern));
    const usableIntercepts: InterceptedRoute[] = [];
    for (const ic of intercepts) {
        if (targetPatterns.has(ic.targetPattern)) {
            usableIntercepts.push(ic);
        } else {
            console.warn(
                `[vite-plugin-react-app-router] intercepting route at "${ic.pagePath}" ` +
                `targets "${ic.targetPattern}" but no regular page exists for that path; ` +
                `skipping interception. Create a page.tsx at that route to enable it.`
            );
        }
    }

    const interceptsByTarget = new Map<string, InterceptedRoute[]>();
    for (const ic of usableIntercepts) {
        const list = interceptsByTarget.get(ic.targetPattern) || [];
        list.push(ic);
        interceptsByTarget.set(ic.targetPattern, list);
    }

    // The tree-based path produces correct error-boundary placement (matching
    // Next.js semantics: error.tsx renders in the <Outlet/> of its segment's
    // layout, not at the leaf). Tree is always provided in production by the
    // server/build handlers.
    const useTree = !!tree;

    let statements: t.Statement[];
    let componentMap: Map<string, string>;
    let layoutMap: Map<string, string>;
    let loadingMap: Map<string, string>;
    let errorMap: Map<string, string>;
    let notFoundMap: Map<string, string>;
    let interceptMap: Map<string, string>;

    if (useTree) {
        const paths = collectPathsFromTree(tree!, {
            layoutPath: rootLayout,
            pagePath: rootPage,
            loadingPath: rootLoading,
            errorPath: rootError,
            notFoundPath: rootNotFound,
        });
        ({ statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap, interceptMap } =
            collectImportsFromPaths(paths, rootDir, lazy, usableIntercepts));
    } else {
        ({ statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap, interceptMap } =
            collectImports(routes, rootDir, lazy, rootNotFound, usableIntercepts));
    }

    if (usableIntercepts.length > 0) {
        statements.push(createInterceptResolverDeclaration());
    }

    const routeDefinitions: t.ObjectExpression[] = [];

    if (useTree) {
        const ctx: BuilderCtx = {
            componentMap,
            layoutMap,
            loadingMap,
            errorMap,
            notFoundMap,
            interceptMap,
            interceptsByTarget,
            lazy,
        };

        // Synthesise a virtual root node from the per-app metadata so the
        // recursive builder treats the app root uniformly with deeper segments.
        const virtualRoot: RouteNode = {
            segment: '',
            path: '/',
            isDynamic: false,
            isCatchAll: false,
            isOptionalCatchAll: false,
            isGroup: false,
            children: tree!,
            ...(rootLayout ? { layoutPath: rootLayout } : {}),
            ...(rootPage ? { pagePath: rootPage } : {}),
            ...(rootError ? { errorPath: rootError } : {}),
            ...(rootLoading ? { loadingPath: rootLoading } : {}),
            ...(rootNotFound ? { notFoundPath: rootNotFound } : {}),
        };

        routeDefinitions.push(...buildSubtree(virtualRoot, undefined, ctx, true));
    } else {
        // Legacy flat path: kept so external callers passing only `routes` still
        // produce working output (errorElement falls on the page node — the old
        // behavior).
        const routesByRootLayout = new Map<string, ParsedRoute[]>();
        const routesWithoutLayout: ParsedRoute[] = [];

        for (const route of routes) {
            if (route.layouts.length > 0) {
                const rootLayoutPath = route.layouts[0]!;
                if (!routesByRootLayout.has(rootLayoutPath)) {
                    routesByRootLayout.set(rootLayoutPath, []);
                }
                routesByRootLayout.get(rootLayoutPath)!.push(route);
            } else {
                routesWithoutLayout.push(route);
            }
        }

        const findRootContextComponents = (layoutRoutes: ParsedRoute[]) => {
            const firstRoute = layoutRoutes[0];
            return {
                loadingPath: firstRoute?.loadingPath,
                errorPath: firstRoute?.errorPath,
            };
        };

        for (const [rootLayoutPath, layoutRoutes] of routesByRootLayout) {
            const rootLayoutName = layoutMap.get(rootLayoutPath)!;
            const rootContext = findRootContextComponents(layoutRoutes);
            const rootLoadingName = rootContext.loadingPath ? loadingMap.get(rootContext.loadingPath) : undefined;
            const rootErrorName = rootContext.errorPath ? errorMap.get(rootContext.errorPath) : undefined;

            const childRoutes = layoutRoutes.map((route) =>
                buildRouteExpression(
                    route,
                    componentMap,
                    layoutMap,
                    loadingMap,
                    errorMap,
                    notFoundMap,
                    interceptMap,
                    interceptsByTarget,
                    lazy
                )
            );

            const rootRouteProps: t.ObjectProperty[] = [
                createRouteProperty('path', t.stringLiteral('/')),
                createRouteProperty('element', createSuspenseWrapper(rootLayoutName, lazy, rootLoadingName)),
                createRouteProperty('children', t.arrayExpression(childRoutes)),
            ];

            if (rootErrorName) {
                rootRouteProps.push(
                    createRouteProperty('errorElement', createCreateElementCallExpression(rootErrorName, t.nullLiteral(), []))
                );
            }

            routeDefinitions.push(createRouteObject(rootRouteProps));
        }

        for (const route of routesWithoutLayout) {
            const pageName = componentMap.get(route.pagePath)!;
            const loadingName = route.loadingPath ? loadingMap.get(route.loadingPath) : undefined;
            const errorName = route.errorPath ? errorMap.get(route.errorPath) : undefined;

            let pageElement: t.Expression = createSuspenseWrapper(pageName, lazy, loadingName);
            const targetIntercepts = interceptsByTarget.get(route.pattern);
            if (targetIntercepts && targetIntercepts.length > 0) {
                pageElement = wrapWithInterceptResolver(
                    pageElement,
                    targetIntercepts,
                    interceptMap,
                    loadingMap,
                    lazy
                );
            }

            const routeProps: t.ObjectProperty[] = [
                createRouteProperty('path', t.stringLiteral(route.pattern)),
                createRouteProperty('element', pageElement),
            ];

            if (errorName) {
                routeProps.push(
                    createRouteProperty('errorElement', createCreateElementCallExpression(errorName, t.nullLiteral(), []))
                );
            }

            routeDefinitions.push(createRouteObject(routeProps));
        }
    }

    // Add catch-all not-found route at root level (outside of layout)
    // Root not-found replaces everything, including the layout
    if (rootNotFound && notFoundMap.has(rootNotFound)) {
        const notFoundName = notFoundMap.get(rootNotFound)!;
        routeDefinitions.push(
            createRouteObject([
                createRouteProperty('path', t.stringLiteral('*')),
                createRouteProperty('element', createSuspenseWrapper(notFoundName, lazy)),
            ])
        );
    }

    // const routes = [...]
    statements.push(
        t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier('routes'), t.arrayExpression(routeDefinitions)),
        ])
    );

    // const router = createBrowserRouter(routes)
    statements.push(
        t.variableDeclaration('const', [
            t.variableDeclarator(
                t.identifier('router'),
                t.callExpression(t.identifier('createBrowserRouter'), [t.identifier('routes')])
            ),
        ])
    );

    // export function AppRouter() { return createElement(RouterProvider, { router }); }
    const appRouterFunction = t.functionDeclaration(
        t.identifier('AppRouter'),
        [],
        t.blockStatement([
            t.returnStatement(
                t.callExpression(t.identifier('createElement'), [
                    t.identifier('RouterProvider'),
                    t.objectExpression([
                        t.objectProperty(t.identifier('router'), t.identifier('router')),
                    ]),
                ])
            ),
        ])
    );
    statements.push(t.exportNamedDeclaration(appRouterFunction));

    // export { router, routes }
    statements.push(
        t.exportNamedDeclaration(null, [
            t.exportSpecifier(t.identifier('router'), t.identifier('router')),
            t.exportSpecifier(t.identifier('routes'), t.identifier('routes')),
        ])
    );

    // export default AppRouter
    statements.push(t.exportDefaultDeclaration(t.identifier('AppRouter')));

    return t.program(statements);
}

/**
 * Generates AST for empty routes
 */
function generateEmptyRoutesAST(): t.Program {
    const statements: t.Statement[] = [];

    // import { createElement } from 'react'
    statements.push(
        createImportDeclaration([createNamedImport('createElement')], 'react')
    );

    // import { createBrowserRouter, RouterProvider } from 'react-router-dom'
    statements.push(
        createImportDeclaration(
            [createNamedImport('createBrowserRouter'), createNamedImport('RouterProvider')],
            'react-router-dom'
        )
    );

    // const router = createBrowserRouter([])
    statements.push(
        t.variableDeclaration('const', [
            t.variableDeclarator(
                t.identifier('router'),
                t.callExpression(t.identifier('createBrowserRouter'), [t.arrayExpression([])])
            ),
        ])
    );

    // export function AppRouter() { return createElement(RouterProvider, { router }); }
    const appRouterFunction = t.functionDeclaration(
        t.identifier('AppRouter'),
        [],
        t.blockStatement([
            t.returnStatement(
                t.callExpression(t.identifier('createElement'), [
                    t.identifier('RouterProvider'),
                    t.objectExpression([
                        t.objectProperty(t.identifier('router'), t.identifier('router')),
                    ]),
                ])
            ),
        ])
    );
    statements.push(t.exportNamedDeclaration(appRouterFunction));

    // export { router }
    statements.push(
        t.exportNamedDeclaration(null, [
            t.exportSpecifier(t.identifier('router'), t.identifier('router')),
        ])
    );

    // export default AppRouter
    statements.push(t.exportDefaultDeclaration(t.identifier('AppRouter')));

    return t.program(statements);
}

/**
 * Snippet that runs once at module load. Browsers preserve `history.state`
 * across hard refreshes, which would otherwise cause our resolver to keep
 * showing the intercepting page after F5. We strip the marker so the
 * canonical page renders instead — matching Next.js behavior.
 *
 * Must execute *before* `createBrowserRouter` reads the history state.
 */
const HARD_REFRESH_FIX_SNIPPET = `
// vite-plugin-react-app-router: drop appRouterBackgroundLocation on hard refresh
if (typeof window !== "undefined" && typeof performance !== "undefined") {
  try {
    var __vparr_nav__ = performance.getEntriesByType("navigation")[0];
    if (__vparr_nav__ && __vparr_nav__.type === "reload") {
      var __vparr_hist__ = window.history.state;
      var __vparr_usr__ = __vparr_hist__ && __vparr_hist__.usr;
      if (__vparr_usr__ && __vparr_usr__.appRouterBackgroundLocation) {
        var __vparr_nu__ = Object.assign({}, __vparr_usr__);
        delete __vparr_nu__.appRouterBackgroundLocation;
        window.history.replaceState(
          Object.assign({}, __vparr_hist__, { usr: __vparr_nu__ }),
          "",
          window.location.pathname + window.location.search + window.location.hash
        );
      }
    }
  } catch (__vparr_err__) {}
}
`;

/**
 * Inserts a raw code snippet right after the last `import ... from "..."`
 * statement so it runs as early as possible at module load.
 */
function injectAfterImports(code: string, snippet: string): string {
    const lines = code.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^import\b/.test(lines[i]!.trim())) {
            lastImportIdx = i;
        }
    }
    if (lastImportIdx === -1) {
        return snippet.trimStart() + '\n' + code;
    }
    const before = lines.slice(0, lastImportIdx + 1).join('\n');
    const after = lines.slice(lastImportIdx + 1).join('\n');
    return before + '\n' + snippet + (after.startsWith('\n') ? '' : '\n') + after;
}

/**
 * Generates the complete routes module code using AST
 */
export function generateRoutesCode(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): string {
    const ast = generateRoutesAST(routes, options);
    const output = generate(ast, {
        comments: true,
        compact: false,
    });
    let code = output.code;
    if ((options.intercepts || []).length > 0) {
        code = injectAfterImports(code, HARD_REFRESH_FIX_SNIPPET);
    }
    return code;
}

/**
 * Generates optimized code for build
 * Uses lazy loading by default for code splitting
 */
export function generateBuildRoutesCode(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): string {
    return generateRoutesCode(routes, options);
}

/**
 * Generates code for development (with lazy loading and HMR friendly)
 */
export function generateDevRoutesCode(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): string {
    return generateRoutesCode(routes, options);
}

/**
 * Generates empty routes code (fallback when no routes exist)
 */
export function generateEmptyRoutesCode(): string {
    const ast = generateEmptyRoutesAST();
    const output = generate(ast, {
        comments: true,
        compact: false,
    });
    return output.code;
}
