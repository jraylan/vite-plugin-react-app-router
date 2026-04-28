/**
 * Code generator for react-router-dom using AST
 * Generates the virtual module code that exports routes
 *
 * Uses nested routes for layouts, enabling efficient SPA navigation
 */

import * as t from '@babel/types';
import _generate from '@babel/generator';
import type { ParsedRoute, InterceptedRoute, RouteNode, ParallelSlot } from './types.js';
import { pathToIdentifier } from './routeParser.js';

/** State key on history.state used to signal an intercepted navigation. */
const BACKGROUND_LOCATION_KEY = 'appRouterBackgroundLocation';

/**
 * State key that, when truthy, opts a single navigation out of the intercept
 * source check. The matcher then picks any intercept whose target matches the
 * destination, regardless of whether `bg.pathname` matches its declared
 * source. Useful for cross-area links (e.g. opening a clientes overlay from
 * /chamados, where /chamados isn't paired as a source for that intercept).
 */
const ANY_SOURCE_KEY = 'appRouterAnySource';

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

    let pageIndex = 0;
    let layoutIndex = 0;
    let loadingIndex = 0;
    let errorIndex = 0;
    let notFoundIndex = 0;
    const seenLayouts = new Set<string>();
    const seenLoading = new Set<string>();
    const seenError = new Set<string>();
    const seenNotFound = new Set<string>();

    const hasIntercepts = intercepts.length > 0;

    // Import from react-router-dom. Two router shapes:
    //   - intercept mode → BrowserRouter + useRoutes (preserves BG instances)
    //   - regular mode  → createBrowserRouter + RouterProvider (data router)
    const rrSpecifiers: t.ImportSpecifier[] = [createNamedImport('Outlet')];
    if (hasIntercepts) {
        rrSpecifiers.push(createNamedImport('BrowserRouter'));
        rrSpecifiers.push(createNamedImport('useRoutes'));
        rrSpecifiers.push(createNamedImport('useLocation'));
        rrSpecifiers.push(createNamedImport('matchPath'));
        // Routes/Route wrap the intercept overlay so the intercepting page
        // sees its `:param` segments via useParams(). Without a parent <Route>
        // there is no match record and useParams returns `{}`.
        rrSpecifiers.push(createNamedImport('Routes'));
        rrSpecifiers.push(createNamedImport('Route'));
    } else {
        rrSpecifiers.push(createNamedImport('createBrowserRouter'));
        rrSpecifiers.push(createNamedImport('RouterProvider'));
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

    // Walk each intercept's subtree to import its page/layout/loading/error
    // /not-found files. Intercept routes are no longer flat-per-leaf — each
    // entry carries a full RouteNode subtree so the overlay can mount tab-
    // style navigation under its own layout.
    const seenPage = new Set<string>(componentMap.keys());
    const importPage = (filePath: string): void => {
        if (seenPage.has(filePath)) return;
        seenPage.add(filePath);
        const name = `Page${generateImportName('', filePath, pageIndex++)}`;
        const importPath = normalizeImportPath(filePath, rootDir);
        if (lazy) statements.push(createLazyImport(name, importPath));
        else statements.push(createImportDeclaration([createDefaultImport(name)], `/${importPath}`));
        componentMap.set(filePath, name);
    };
    const importLayout = (filePath: string): void => {
        if (seenLayouts.has(filePath)) return;
        seenLayouts.add(filePath);
        const name = `Layout${layoutIndex++}`;
        const importPath = normalizeImportPath(filePath, rootDir);
        if (lazy) statements.push(createLazyImport(name, importPath));
        else statements.push(createImportDeclaration([createDefaultImport(name)], `/${importPath}`));
        layoutMap.set(filePath, name);
    };
    const importLoading = (filePath: string): void => {
        if (seenLoading.has(filePath)) return;
        seenLoading.add(filePath);
        const name = `Loading${loadingIndex++}`;
        const importPath = normalizeImportPath(filePath, rootDir);
        if (lazy) statements.push(createLazyImport(name, importPath));
        else statements.push(createImportDeclaration([createDefaultImport(name)], `/${importPath}`));
        loadingMap.set(filePath, name);
    };
    const importError = (filePath: string): void => {
        if (seenError.has(filePath)) return;
        seenError.add(filePath);
        const name = `ErrorBoundary${errorIndex++}`;
        const importPath = normalizeImportPath(filePath, rootDir);
        if (lazy) statements.push(createLazyImport(name, importPath));
        else statements.push(createImportDeclaration([createDefaultImport(name)], `/${importPath}`));
        errorMap.set(filePath, name);
    };
    const importNotFound = (filePath: string): void => {
        if (seenNotFound.has(filePath)) return;
        seenNotFound.add(filePath);
        const name = `NotFound${notFoundIndex++}`;
        const importPath = normalizeImportPath(filePath, rootDir);
        if (lazy) statements.push(createLazyImport(name, importPath));
        else statements.push(createImportDeclaration([createDefaultImport(name)], `/${importPath}`));
        notFoundMap.set(filePath, name);
    };

    function walkInterceptNode(node: RouteNode): void {
        if (node.pagePath) importPage(node.pagePath);
        if (node.layoutPath) importLayout(node.layoutPath);
        if (node.loadingPath) importLoading(node.loadingPath);
        if (node.errorPath) importError(node.errorPath);
        if (node.notFoundPath) importNotFound(node.notFoundPath);
        for (const c of node.children) walkInterceptNode(c);
    }
    for (const ic of intercepts) walkInterceptNode(ic.subtree);

    return { statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap };
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
    lazy: boolean
): t.ObjectExpression {
    const pageName = componentMap.get(route.pagePath)!;
    const isIndex = route.pattern === '/';
    const path = isIndex ? '' : route.pattern.replace(/^\//, '');

    // Get loading and error component names if available
    const loadingName = route.loadingPath ? loadingMap.get(route.loadingPath) : undefined;
    const errorName = route.errorPath ? errorMap.get(route.errorPath) : undefined;

    // Pages no longer wrap with an intercept resolver — interception is
    // handled at the AppRouter (InnerRouter) level via BrowserRouter+useRoutes.
    const pageElement: t.Expression = createSuspenseWrapper(pageName, lazy, loadingName);

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
    /** Parallel-route slots owned by the app root segment. */
    rootSlots?: ParallelSlot[];
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
    /** Map of `default.tsx` absolute path → import name. */
    defaultMap: Map<string, string>;
    /** Map of `props.tsx` absolute path → import name (eager default import). */
    sharedPropsMap: Map<string, string>;
    lazy: boolean;
}

/**
 * Returns true if any node in the tree (or its descendants, including inside
 * other slots) declares parallel slots. Used to decide whether to emit the
 * SlotProvider import.
 */
function hasSlotInAnyNode(tree: RouteNode[]): boolean {
    for (const n of tree) {
        if (n.slots && n.slots.length > 0) return true;
        if (hasSlotInAnyNode(n.children)) return true;
        if (n.slots) {
            for (const s of n.slots) {
                if (hasSlotInAnyNode(s.tree)) return true;
            }
        }
    }
    return false;
}

/**
 * Returns true if any node in the tree carries a shared-module invocation
 * marker (placed there by graftSharedModule). Drives whether the codegen
 * emits the SharedModuleProvider import.
 */
function hasSharedInvocationInAnyNode(tree: RouteNode[]): boolean {
    for (const n of tree) {
        if (n.sharedInvocation) return true;
        if (hasSharedInvocationInAnyNode(n.children)) return true;
        if (n.slots) {
            for (const s of n.slots) {
                if (hasSharedInvocationInAnyNode(s.tree)) return true;
            }
        }
    }
    return false;
}

/**
 * Collects every shared-module invocation site as a map of
 * `name -> [mountUrl...]`. One entry per unique `(name, mountUrl)` pair, in
 * tree-traversal order. Powers the `__templateRegistry__` constant consumed
 * by `useTemplateLink`.
 */
function collectTemplateRegistry(tree: RouteNode[]): Map<string, string[]> {
    const reg = new Map<string, string[]>();
    function walk(nodes: RouteNode[]): void {
        for (const n of nodes) {
            if (n.sharedInvocation) {
                const url = n.path || '/';
                const arr = reg.get(n.sharedInvocation.name) ?? [];
                if (!arr.includes(url)) arr.push(url);
                reg.set(n.sharedInvocation.name, arr);
            }
            walk(n.children);
            if (n.slots) {
                for (const s of n.slots) walk(s.tree);
            }
        }
    }
    walk(tree);
    return reg;
}

function buildTemplateRegistryAST(
    reg: Map<string, string[]>
): t.ObjectExpression {
    const props: t.ObjectProperty[] = [];
    for (const [name, urls] of reg) {
        props.push(
            t.objectProperty(
                t.stringLiteral(name),
                t.arrayExpression(
                    urls.map((u) =>
                        t.objectExpression([
                            t.objectProperty(
                                t.identifier('mountUrl'),
                                t.stringLiteral(u)
                            ),
                        ])
                    )
                )
            )
        );
    }
    return t.objectExpression(props);
}

/**
 * Returns true if any node carries a `sharedPropsPath` (props.tsx at an
 * invocation site). Drives the SharedPropsProvider import + provider wrap.
 */
function hasSharedPropsInAnyNode(tree: RouteNode[]): boolean {
    for (const n of tree) {
        if (n.sharedPropsPath) return true;
        if (hasSharedPropsInAnyNode(n.children)) return true;
        if (n.slots) {
            for (const s of n.slots) {
                if (hasSharedPropsInAnyNode(s.tree)) return true;
            }
        }
    }
    return false;
}

/**
 * Computes a child path relative to the root of the subtree being built.
 *
 *   relativeFromRoot('/dashboard/photo/:id', '/dashboard') -> 'photo/:id'
 *   relativeFromRoot('/about', '/')                         -> 'about'
 *   relativeFromRoot('/dashboard', '/dashboard')            -> ''
 */
function relativeFromRoot(absolute: string, root: string): string {
    if (root === '/' || root === '') return absolute.replace(/^\//, '');
    if (absolute === root) return '';
    if (absolute.startsWith(root + '/')) return absolute.slice(root.length + 1);
    return absolute.replace(/^\//, '');
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
    insideLayout: boolean,
    subtreeRoot: string
): t.ObjectExpression {
    const pageName = ctx.componentMap.get(node.pagePath)!;
    const loadingName = pickLoading(undefined, inheritedLoading, ctx);
    const isAtRoot = node.path === subtreeRoot
        || (subtreeRoot === '/' && (node.path === '' || node.path === '/'));
    const useIndex = insideLayout && isAtRoot;
    const path = isAtRoot ? subtreeRoot : relativeFromRoot(node.path, subtreeRoot);

    // Pages no longer wrap themselves with an intercept resolver — the
    // BrowserRouter+useRoutes mode handles interception at the InnerRouter
    // level so the BG outlet stays mounted as the same React subtree.
    const pageElement: t.Expression = createSuspenseWrapper(pageName, ctx.lazy, loadingName);

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
    isRoot: boolean,
    subtreeRoot: string,
    slotsExpr?: t.Expression,
    sharedInfoExpr?: t.Expression,
    sharedPropsExpr?: t.Expression
): t.ObjectExpression {
    const layoutName = ctx.layoutMap.get(layoutPath)!;
    const loadingName = pickLoading(undefined, inheritedLoading, ctx);
    let element: t.Expression = createSuspenseWrapper(layoutName, ctx.lazy, loadingName);
    if (slotsExpr) {
        // <SlotProvider slots={…}>{<Suspense>…<Layout/>…</Suspense>}</SlotProvider>
        element = createCreateElementCallExpression(
            'SlotProvider',
            t.objectExpression([t.objectProperty(t.identifier('slots'), slotsExpr)]),
            [element]
        );
    }
    if (sharedInfoExpr) {
        element = createCreateElementCallExpression(
            'SharedModuleProvider',
            t.objectExpression([t.objectProperty(t.identifier('info'), sharedInfoExpr)]),
            [element]
        );
    }
    if (sharedPropsExpr) {
        element = createCreateElementCallExpression(
            'SharedPropsProvider',
            t.objectExpression([t.objectProperty(t.identifier('props'), sharedPropsExpr)]),
            [element]
        );
    }
    const props: t.ObjectProperty[] = [];
    if (isRoot) {
        props.push(createRouteProperty('path', t.stringLiteral(subtreeRoot)));
    }
    props.push(createRouteProperty('element', element));
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
    insideLayout: boolean = false,
    subtreeRoot: string = '/',
    bypassInterceptingFilter: boolean = false
): t.ObjectExpression[] {
    // Intercepting subtrees are normally rendered separately by the overlay
    // route table (see buildInterceptsArray); skip them in the canonical
    // walk. The bypass is set when the caller IS the overlay walk.
    if (!bypassInterceptingFilter && node.isIntercepting) return [];

    const localLoading = node.loadingPath || inheritedLoading;

    // The segment is wrapped in a layout iff it has its own layout.tsx OR has
    // slots without a layout (in which case we synthesise an Outlet wrapper so
    // the SlotProvider has somewhere to live).
    const hasSlots = !!(node.slots && node.slots.length > 0);
    const wrapsInLayoutLikeNode = !!node.layoutPath || hasSlots;
    const childrenInsideLayout = insideLayout || wrapsInLayoutLikeNode;

    const inner: t.ObjectExpression[] = [];

    if (node.pagePath) {
        inner.push(
            makePageNode(
                { path: node.path, pagePath: node.pagePath },
                localLoading,
                ctx,
                childrenInsideLayout,
                subtreeRoot
            )
        );
    }

    // Route groups don't contribute their own segment but still emit pages.
    // Their children iterate normally below.
    for (const child of node.children) {
        inner.push(
            ...buildSubtree(
                child,
                localLoading,
                ctx,
                false,
                childrenInsideLayout,
                subtreeRoot,
                bypassInterceptingFilter
            )
        );
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

    // Build the slots prop expression once — used for both the real-layout
    // and synthetic-outlet branches below.
    let slotsExpr: t.Expression | undefined;
    if (hasSlots) {
        slotsExpr = buildSlotsObject(node.slots!, ctx, node.path);
    }

    // Shared-route-module invocation site: emit an info object that the
    // runtime SharedModuleProvider exposes via useSharedModule().
    let sharedInfoExpr: t.Expression | undefined;
    if (node.sharedInvocation) {
        sharedInfoExpr = t.objectExpression([
            t.objectProperty(
                t.identifier('name'),
                t.stringLiteral(node.sharedInvocation.name)
            ),
            t.objectProperty(
                t.identifier('mountUrl'),
                t.stringLiteral(node.path || '/')
            ),
            t.objectProperty(
                t.identifier('activeSubShareds'),
                t.arrayExpression(
                    node.sharedInvocation.activeSubShareds.map((n) => t.stringLiteral(n))
                )
            ),
        ]);
    }

    // props.tsx at this invocation level — pass the imported value to the
    // SharedPropsProvider so descendants can read via useSharedProps().
    let sharedPropsExpr: t.Expression | undefined;
    if (node.sharedPropsPath) {
        const propsName = ctx.sharedPropsMap.get(node.sharedPropsPath);
        if (propsName) sharedPropsExpr = t.identifier(propsName);
    }

    if (node.layoutPath) {
        return [
            makeLayoutNode(
                node.layoutPath,
                inheritedLoading,
                wrapped,
                ctx,
                isRoot,
                subtreeRoot,
                slotsExpr,
                sharedInfoExpr,
                sharedPropsExpr
            ),
        ];
    }

    if (hasSlots || sharedInfoExpr || sharedPropsExpr) {
        // No layout, but the segment needs a wrapping element to host either a
        // SlotProvider (parallel routes) or a SharedModuleProvider (shared
        // module invocation without its own layout). Synthesise an Outlet so
        // descendants render normally.
        let wrappedEl: t.Expression = createCreateElementCallExpression(
            'Outlet',
            t.nullLiteral(),
            []
        );
        if (slotsExpr) {
            wrappedEl = createCreateElementCallExpression(
                'SlotProvider',
                t.objectExpression([t.objectProperty(t.identifier('slots'), slotsExpr)]),
                [wrappedEl]
            );
        }
        if (sharedInfoExpr) {
            wrappedEl = createCreateElementCallExpression(
                'SharedModuleProvider',
                t.objectExpression([t.objectProperty(t.identifier('info'), sharedInfoExpr)]),
                [wrappedEl]
            );
        }
        if (sharedPropsExpr) {
            wrappedEl = createCreateElementCallExpression(
                'SharedPropsProvider',
                t.objectExpression([t.objectProperty(t.identifier('props'), sharedPropsExpr)]),
                [wrappedEl]
            );
        }
        const props: t.ObjectProperty[] = [];
        if (isRoot) {
            props.push(createRouteProperty('path', t.stringLiteral(subtreeRoot)));
        }
        props.push(createRouteProperty('element', wrappedEl));
        props.push(createRouteProperty('children', t.arrayExpression(wrapped)));
        return [createRouteObject(props)];
    }

    // No layout, no slots, no shared-module wrapping: pass children up.
    return wrapped;
}

/**
 * Builds the `slots` object literal passed to <SlotProvider>:
 *
 *   { modal: { routes: [...], defaultElement: <Default/> }, ... }
 *
 * Each slot's routes are produced by buildSubtree on a virtual root rooted at
 * the OWNER's URL — so useRoutes() can match the slot independently against
 * the live location.
 */
function buildSlotsObject(
    slots: ParallelSlot[],
    ctx: BuilderCtx,
    ownerPath: string
): t.ObjectExpression {
    const props: t.ObjectProperty[] = [];
    for (const slot of slots) {
        const slotVirtualRoot: RouteNode = {
            segment: '',
            path: ownerPath,
            isDynamic: false,
            isCatchAll: false,
            isOptionalCatchAll: false,
            isGroup: false,
            children: slot.tree,
            ...(slot.layoutPath ? { layoutPath: slot.layoutPath } : {}),
            ...(slot.pagePath ? { pagePath: slot.pagePath } : {}),
            ...(slot.errorPath ? { errorPath: slot.errorPath } : {}),
            ...(slot.loadingPath ? { loadingPath: slot.loadingPath } : {}),
            ...(slot.notFoundPath ? { notFoundPath: slot.notFoundPath } : {}),
        };

        // Slots are consumed by useRoutes() at runtime with no enclosing
        // parent route, so the paths must be absolute (full URL). We pass
        // subtreeRoot='/' so makePageNode emits absolute patterns, and
        // isRoot=false so any wrapping slot layout stays *pathless* — that
        // way useRoutes returns null when no descendant matches and the
        // SlotRenderer falls through to defaultElement.
        const slotRoutes = buildSubtree(slotVirtualRoot, undefined, ctx, false, false, '/');

        const definitionProps: t.ObjectProperty[] = [
            t.objectProperty(t.identifier('routes'), t.arrayExpression(slotRoutes)),
        ];
        if (slot.defaultPath) {
            const defaultName = ctx.defaultMap.get(slot.defaultPath);
            if (defaultName) {
                definitionProps.push(
                    t.objectProperty(
                        t.identifier('defaultElement'),
                        createSuspenseWrapper(defaultName, ctx.lazy)
                    )
                );
            }
        }
        props.push(t.objectProperty(t.identifier(slot.name), t.objectExpression(definitionProps)));
    }
    return t.objectExpression(props);
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
    /** `default.tsx` of parallel-route slots (rendered when nothing matches). */
    defaults: string[];
    /** `props.tsx` declared at shared-module invocation sites. */
    sharedProps: string[];
}

function collectPathsFromTree(
    tree: RouteNode[],
    rootInfo: {
        layoutPath?: string;
        pagePath?: string;
        loadingPath?: string;
        errorPath?: string;
        notFoundPath?: string;
    },
    rootSlots?: ParallelSlot[]
): CollectedPaths {
    const pages: string[] = [];
    const layouts: string[] = [];
    const loadings: string[] = [];
    const errors: string[] = [];
    const notFounds: string[] = [];
    const defaults: string[] = [];
    const sharedProps: string[] = [];

    if (rootInfo.pagePath) pages.push(rootInfo.pagePath);
    if (rootInfo.layoutPath) layouts.push(rootInfo.layoutPath);
    if (rootInfo.loadingPath) loadings.push(rootInfo.loadingPath);
    if (rootInfo.errorPath) errors.push(rootInfo.errorPath);
    if (rootInfo.notFoundPath) notFounds.push(rootInfo.notFoundPath);

    function walkSlot(slot: ParallelSlot): void {
        if (slot.pagePath) pages.push(slot.pagePath);
        if (slot.layoutPath) layouts.push(slot.layoutPath);
        if (slot.loadingPath) loadings.push(slot.loadingPath);
        if (slot.errorPath) errors.push(slot.errorPath);
        if (slot.notFoundPath) notFounds.push(slot.notFoundPath);
        if (slot.defaultPath) defaults.push(slot.defaultPath);
        for (const c of slot.tree) walk(c);
    }

    function walk(node: RouteNode): void {
        // Intercepting subtrees DO contribute imports — their pages/layouts
        // are rendered via the overlay route table built by
        // buildInterceptsArray. They just don't appear in the canonical
        // routeDefinitions (buildSubtree filters them out by node identity).
        if (node.pagePath) pages.push(node.pagePath);
        if (node.layoutPath) layouts.push(node.layoutPath);
        if (node.loadingPath) loadings.push(node.loadingPath);
        if (node.errorPath) errors.push(node.errorPath);
        if (node.notFoundPath) notFounds.push(node.notFoundPath);
        if (node.sharedPropsPath) sharedProps.push(node.sharedPropsPath);
        if (node.slots) for (const s of node.slots) walkSlot(s);
        for (const c of node.children) walk(c);
    }
    for (const n of tree) walk(n);
    if (rootSlots) for (const s of rootSlots) walkSlot(s);

    return { pages, layouts, loadings, errors, notFounds, defaults, sharedProps };
}

/**
 * Builds the import statements + maps from a path-collection. Used by the
 * tree-based code path (the legacy route-based path keeps using `collectImports`).
 */
function collectImportsFromPaths(
    paths: CollectedPaths,
    rootDir: string,
    lazy: boolean,
    intercepts: InterceptedRoute[],
    hasSlots: boolean,
    hasSharedInvocations: boolean,
    hasSharedProps: boolean
): {
    statements: t.Statement[];
    componentMap: Map<string, string>;
    layoutMap: Map<string, string>;
    loadingMap: Map<string, string>;
    errorMap: Map<string, string>;
    notFoundMap: Map<string, string>;
    defaultMap: Map<string, string>;
    sharedPropsMap: Map<string, string>;
} {
    const statements: t.Statement[] = [];
    const componentMap = new Map<string, string>();
    const layoutMap = new Map<string, string>();
    const loadingMap = new Map<string, string>();
    const errorMap = new Map<string, string>();
    const notFoundMap = new Map<string, string>();
    const defaultMap = new Map<string, string>();
    const sharedPropsMap = new Map<string, string>();

    const hasIntercepts = intercepts.length > 0;

    const rrSpecifiers: t.ImportSpecifier[] = [createNamedImport('Outlet')];
    if (hasIntercepts) {
        // Intercept mode: BrowserRouter + useRoutes so we can match against a
        // background location and keep the BG outlet mounted as the same
        // React subtree across the URL change. The overlay is rendered via
        // useRoutes() against a per-intercept routes table (built by
        // buildInterceptsArray) so route params and layouts work the same
        // way they do for canonical routes.
        rrSpecifiers.push(createNamedImport('BrowserRouter'));
        rrSpecifiers.push(createNamedImport('useRoutes'));
        rrSpecifiers.push(createNamedImport('useLocation'));
        rrSpecifiers.push(createNamedImport('matchPath'));
    } else {
        rrSpecifiers.push(createNamedImport('createBrowserRouter'));
        rrSpecifiers.push(createNamedImport('RouterProvider'));
    }
    statements.push(createImportDeclaration(rrSpecifiers, 'react-router-dom'));

    // Pull runtime providers from the package — SlotProvider (parallel routes),
    // SharedModuleProvider (shared route modules), SharedPropsProvider
    // (props.tsx forwarding), and createUseTemplateLink (template-link hook
    // factory). One import statement when any are in use.
    {
        const specs: t.ImportSpecifier[] = [];
        if (hasSlots) specs.push(createNamedImport('SlotProvider'));
        if (hasSharedInvocations) specs.push(createNamedImport('SharedModuleProvider'));
        if (hasSharedProps) specs.push(createNamedImport('SharedPropsProvider'));
        // Always import — `useTemplateLink` is exported from every virtual
        // module so consumers can call it even before any +shared/ exists.
        specs.push(createNamedImport('createUseTemplateLink'));
        statements.push(
            createImportDeclaration(specs, 'vite-plugin-react-app-router/runtime')
        );
    }

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

    // Tracks identifier names already used across all emit() / emitEager()
    // calls in this module so distinct paths whose safeIdent collapses to the
    // same value (e.g. `+(.)[id]` and `+[id]` both → `…IdLayout`) get unique
    // suffixes instead of producing a duplicate `const` declaration.
    const usedIdentifiers = new Set<string>();

    function uniqueName(prefix: string, base: string, fallbackIndex: number): string {
        let name = `${prefix}${base || fallbackIndex}`;
        if (!usedIdentifiers.has(name)) {
            usedIdentifiers.add(name);
            return name;
        }
        let attempt = 2;
        while (usedIdentifiers.has(`${name}_${attempt}`)) attempt++;
        const unique = `${name}_${attempt}`;
        usedIdentifiers.add(unique);
        return unique;
    }

    function emit(prefix: string, kind: Map<string, string>, paths: string[]): void {
        let i = 0;
        const seen = new Set<string>();
        for (const p of paths) {
            if (seen.has(p)) continue;
            seen.add(p);
            const safe = safeIdent(p);
            const name = uniqueName(prefix, safe, i++);
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

    /**
     * Emit eager default imports (never lazy). Used for `props.tsx` modules
     * since their values are read synchronously when wrapping the subtree —
     * a Promise from React.lazy would not be a usable props object.
     */
    function emitEager(prefix: string, kind: Map<string, string>, paths: string[]): void {
        let i = 0;
        const seen = new Set<string>();
        for (const p of paths) {
            if (seen.has(p)) continue;
            seen.add(p);
            const safe = safeIdent(p);
            const name = uniqueName(prefix, safe, i++);
            const importPath = normalizeImportPath(p, rootDir);
            statements.push(
                createImportDeclaration([createDefaultImport(name)], `/${importPath}`)
            );
            kind.set(p, name);
        }
    }

    emit('Page', componentMap, paths.pages);
    emit('Layout', layoutMap, paths.layouts);
    emit('Loading', loadingMap, paths.loadings);
    emit('ErrorBoundary', errorMap, paths.errors);
    emit('NotFound', notFoundMap, paths.notFounds);
    emit('Default', defaultMap, paths.defaults);
    emitEager('SharedProps', sharedPropsMap, paths.sharedProps);

    // Intercept subtrees ride on the canonical maps — collectPathsFromTree
    // walks intercepting nodes too, so their pages/layouts/loadings already
    // landed in `paths.*`. The legacy interceptMap return is kept for API
    // shape but is left empty (its consumers now look up components in
    // componentMap directly).

    return {
        statements,
        componentMap,
        layoutMap,
        loadingMap,
        errorMap,
        notFoundMap,
        defaultMap,
        sharedPropsMap,
    };
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
        rootSlots,
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
                `[vite-plugin-react-app-router] intercepting subtree at "${ic.targetPattern}" ` +
                `has no regular page mounted at that target; skipping interception. ` +
                `Create a page.tsx at that route to enable it.`
            );
        }
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
    let defaultMap: Map<string, string> = new Map();
    let sharedPropsMap: Map<string, string> = new Map();

    // Detect any slot, shared-module invocation, or shared props anywhere in
    // the tree to know which runtime imports must be emitted.
    const hasAnySlot = !!(
        (rootSlots && rootSlots.length > 0) ||
        (tree && hasSlotInAnyNode(tree))
    );
    const hasAnySharedInvocation = !!(tree && hasSharedInvocationInAnyNode(tree));
    const hasAnySharedProps = !!(tree && hasSharedPropsInAnyNode(tree));

    if (useTree) {
        const paths = collectPathsFromTree(
            tree!,
            {
                layoutPath: rootLayout,
                pagePath: rootPage,
                loadingPath: rootLoading,
                errorPath: rootError,
                notFoundPath: rootNotFound,
            },
            rootSlots
        );
        ({
            statements,
            componentMap,
            layoutMap,
            loadingMap,
            errorMap,
            notFoundMap,
            defaultMap,
            sharedPropsMap,
        } = collectImportsFromPaths(
            paths,
            rootDir,
            lazy,
            usableIntercepts,
            hasAnySlot,
            hasAnySharedInvocation,
            hasAnySharedProps
        ));
    } else {
        ({ statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap } =
            collectImports(routes, rootDir, lazy, rootNotFound, usableIntercepts));
    }

    // The legacy resolver-per-target wrapper is gone — interception is done at
    // the AppRouter level (BrowserRouter+useRoutes) so the BG outlet stays
    // mounted across the URL change.

    const routeDefinitions: t.ObjectExpression[] = [];

    if (useTree) {
        const ctx: BuilderCtx = {
            componentMap,
            layoutMap,
            loadingMap,
            errorMap,
            notFoundMap,
            defaultMap,
            sharedPropsMap,
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
            ...(rootSlots && rootSlots.length > 0 ? { slots: rootSlots } : {}),
        };

        routeDefinitions.push(...buildSubtree(virtualRoot, undefined, ctx, true, false, '/'));
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

            const pageElement: t.Expression = createSuspenseWrapper(pageName, lazy, loadingName);

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

    // const __templateRegistry__ = { ... }
    // export const useTemplateLink = createUseTemplateLink(__templateRegistry__)
    // Emitted unconditionally so user code can import `useTemplateLink` from
    // the virtual module even when no `+name/` directories exist yet — the
    // registry is just empty and the hook throws on call with a clear message.
    const templateRegistry = tree
        ? collectTemplateRegistry(tree)
        : new Map<string, string[]>();
    statements.push(
        t.variableDeclaration('const', [
            t.variableDeclarator(
                t.identifier('__templateRegistry__'),
                buildTemplateRegistryAST(templateRegistry)
            ),
        ])
    );
    statements.push(
        t.exportNamedDeclaration(
            t.variableDeclaration('const', [
                t.variableDeclarator(
                    t.identifier('useTemplateLink'),
                    t.callExpression(t.identifier('createUseTemplateLink'), [
                        t.identifier('__templateRegistry__'),
                    ])
                ),
            ])
        )
    );

    if (usableIntercepts.length > 0) {
        // Intercept mode — emit an __intercepts__ table where each entry is
        // a self-contained route table for the overlay (intercept template's
        // layout/page wrapping the canonical's sub-shareds), plus an
        // InnerRouter component that lives inside <BrowserRouter> and runs
        // useRoutes() against the matched entry's table on the live location.
        // Main route table runs against the bg location when an intercept
        // matches, so the BG component instances stay mounted across the URL
        // change and the intercept renders as an overlay sibling.
        const interceptCtx: BuilderCtx = {
            componentMap,
            layoutMap,
            loadingMap,
            errorMap,
            notFoundMap,
            defaultMap,
            sharedPropsMap,
            lazy,
        };
        statements.push(buildInterceptsArray(usableIntercepts, interceptCtx));
        statements.push(...buildInnerRouterDeclaration());
        statements.push(buildInterceptModeAppRouter());
        // Intercept mode uses <BrowserRouter> + useRoutes() instead of the
        // data router, so there is no createBrowserRouter instance. Still
        // emit `router` (as null) so consumers re-exporting the virtual
        // module's full surface (e.g. client.ts) don't fail to resolve the
        // binding at import time.
        statements.push(
            t.variableDeclaration('const', [
                t.variableDeclarator(t.identifier('router'), t.nullLiteral()),
            ])
        );
        // export { router, routes }
        statements.push(
            t.exportNamedDeclaration(null, [
                t.exportSpecifier(t.identifier('router'), t.identifier('router')),
                t.exportSpecifier(t.identifier('routes'), t.identifier('routes')),
            ])
        );
    } else {
        // Regular mode — data router via createBrowserRouter.
        statements.push(
            t.variableDeclaration('const', [
                t.variableDeclarator(
                    t.identifier('router'),
                    t.callExpression(t.identifier('createBrowserRouter'), [
                        t.identifier('routes'),
                    ])
                ),
            ])
        );

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
    }

    // Re-export runtime hooks from the virtual module so consumers can
    // `import { useSharedModule, useSlot, ... } from 'virtual:app-router'`
    // alongside AppRouter / useTemplateLink.
    statements.push(
        t.exportNamedDeclaration(
            null,
            [
                t.exportSpecifier(t.identifier('useSlot'), t.identifier('useSlot')),
                t.exportSpecifier(
                    t.identifier('useSharedModule'),
                    t.identifier('useSharedModule')
                ),
                t.exportSpecifier(
                    t.identifier('useSharedSlot'),
                    t.identifier('useSharedSlot')
                ),
                t.exportSpecifier(
                    t.identifier('useSharedProps'),
                    t.identifier('useSharedProps')
                ),
            ],
            t.stringLiteral('vite-plugin-react-app-router/runtime')
        )
    );

    // export default AppRouter
    statements.push(t.exportDefaultDeclaration(t.identifier('AppRouter')));

    return t.program(statements);
}

/**
 * Emits:
 *   const __intercepts__ = [
 *     {
 *       source: '/clientes',
 *       target: '/clientes/:id',
 *       routes: [
 *         {
 *           path: '/clientes/:id',
 *           element: <Suspense>…<InterceptLayout/>…</Suspense>,
 *           children: [
 *             { index: true, element: <Suspense>…<InterceptIndexPage/>…</Suspense> },
 *             { path: 'info', element: <Suspense>…<InfoPage/>…</Suspense> },
 *             { path: 'atendimentos', element: <Suspense>…<AtendimentosPage/>…</Suspense> },
 *             ...
 *           ],
 *         },
 *       ],
 *     },
 *     ...
 *   ];
 *
 * Each entry's `routes` is a full route table built from the intercept's
 * grafted RouteNode subtree, so the overlay can render its own layout shell
 * (e.g. a Sheet/drawer) wrapping the paired canonical's sub-shareds — keeping
 * the drawer mounted while tab-style sub-routes change.
 */
function buildInterceptsArray(
    intercepts: InterceptedRoute[],
    ctx: BuilderCtx
): t.VariableDeclaration {
    const entries = intercepts.map((ic) => {
        // Build the overlay's route table by walking the grafted subtree.
        // bypassInterceptingFilter=true so buildSubtree doesn't strip the
        // tree (it's marked intercepting end-to-end). subtreeRoot=target so
        // the root layout gets `path: targetPattern` and descendants emit
        // relative paths react-router can nest.
        const subtreeRoutes = buildSubtree(
            ic.subtree,
            undefined,
            ctx,
            /* isRoot */ true,
            /* insideLayout */ false,
            /* subtreeRoot */ ic.targetPattern,
            /* bypassInterceptingFilter */ true
        );
        return t.objectExpression([
            t.objectProperty(t.identifier('source'), t.stringLiteral(ic.sourcePattern)),
            t.objectProperty(t.identifier('target'), t.stringLiteral(ic.targetPattern)),
            t.objectProperty(t.identifier('routes'), t.arrayExpression(subtreeRoutes)),
        ]);
    });
    return t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('__intercepts__'),
            t.arrayExpression(entries)
        ),
    ]);
}

/**
 * Emits:
 *
 *   const __EMPTY_OVERLAY_ROUTES__ = [];
 *
 *   function __innerRouter__() {
 *     const location = useLocation();
 *     const state = location.state;
 *     const bg = state && state.appRouterBackgroundLocation;
 *     let overlayRoutes = null;
 *     let baseLoc = location;
 *     if (bg && bg.pathname) {
 *       for (let i = 0; i < __intercepts__.length; i++) {
 *         const ic = __intercepts__[i];
 *         if (
 *           matchPath({ path: ic.source, end: false }, bg.pathname) &&
 *           matchPath({ path: ic.target, end: false }, location.pathname)
 *         ) {
 *           overlayRoutes = ic.routes;
 *           baseLoc = bg;
 *           break;
 *         }
 *       }
 *     }
 *     const main = useRoutes(routes, baseLoc);
 *     const overlay = useRoutes(overlayRoutes || __EMPTY_OVERLAY_ROUTES__, location);
 *     return createElement(React.Fragment, null, main, overlay);
 *   }
 *
 * Notes:
 *   - target match uses end:false so /clientes/:id/info still matches when
 *     the intercept is rooted at /clientes/:id (drawer stays mounted across
 *     tab navigation inside it).
 *   - overlay's useRoutes is called unconditionally (rules of hooks); the
 *     empty-array sentinel is hoisted to module scope so React sees the same
 *     reference across renders and doesn't churn its internal route cache.
 */
function buildInnerRouterDeclaration(): t.Statement[] {
    // Sentinel route table used when no intercept is active. A literal `[]`
    // would make `useRoutes` log "No routes matched location ..." every render
    // (React Router warns whenever its match returns null). A single catch-all
    // route with `element: null` always matches and renders nothing, so the
    // overlay slot stays silent until an intercept fires.
    const emptyDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('__EMPTY_OVERLAY_ROUTES__'),
            t.arrayExpression([
                t.objectExpression([
                    t.objectProperty(t.identifier('path'), t.stringLiteral('*')),
                    t.objectProperty(t.identifier('element'), t.nullLiteral()),
                ]),
            ])
        ),
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
    // const anySource = state && state.appRouterAnySource;
    const anySourceDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('anySource'),
            t.logicalExpression(
                '&&',
                t.identifier('state'),
                t.memberExpression(t.identifier('state'), t.identifier(ANY_SOURCE_KEY))
            )
        ),
    ]);
    const overlayRoutesDecl = t.variableDeclaration('let', [
        t.variableDeclarator(t.identifier('overlayRoutes'), t.nullLiteral()),
    ]);
    const baseLocDecl = t.variableDeclaration('let', [
        t.variableDeclarator(t.identifier('baseLoc'), t.identifier('location')),
    ]);

    // matchPath({ path: ic.source, end: false }, bg.pathname)
    const sourceMatch = t.callExpression(t.identifier('matchPath'), [
        t.objectExpression([
            t.objectProperty(
                t.identifier('path'),
                t.memberExpression(t.identifier('ic'), t.identifier('source'))
            ),
            t.objectProperty(t.identifier('end'), t.booleanLiteral(false)),
        ]),
        t.memberExpression(t.identifier('bg'), t.identifier('pathname')),
    ]);
    // matchPath({ path: ic.target, end: false }, location.pathname)
    const targetMatch = t.callExpression(t.identifier('matchPath'), [
        t.objectExpression([
            t.objectProperty(
                t.identifier('path'),
                t.memberExpression(t.identifier('ic'), t.identifier('target'))
            ),
            t.objectProperty(t.identifier('end'), t.booleanLiteral(false)),
        ]),
        t.memberExpression(t.identifier('location'), t.identifier('pathname')),
    ]);

    // Match when target hits AND (caller opted out via anySource OR the
    // intercept's declared source matches the bg location).
    const ifMatch = t.ifStatement(
        t.logicalExpression(
            '&&',
            t.logicalExpression('||', t.identifier('anySource'), sourceMatch),
            targetMatch
        ),
        t.blockStatement([
            t.expressionStatement(
                t.assignmentExpression(
                    '=',
                    t.identifier('overlayRoutes'),
                    t.memberExpression(t.identifier('ic'), t.identifier('routes'))
                )
            ),
            t.expressionStatement(
                t.assignmentExpression('=', t.identifier('baseLoc'), t.identifier('bg'))
            ),
            t.breakStatement(),
        ])
    );

    const forStmt = t.forStatement(
        t.variableDeclaration('let', [
            t.variableDeclarator(t.identifier('i'), t.numericLiteral(0)),
        ]),
        t.binaryExpression(
            '<',
            t.identifier('i'),
            t.memberExpression(t.identifier('__intercepts__'), t.identifier('length'))
        ),
        t.updateExpression('++', t.identifier('i')),
        t.blockStatement([
            t.variableDeclaration('const', [
                t.variableDeclarator(
                    t.identifier('ic'),
                    t.memberExpression(
                        t.identifier('__intercepts__'),
                        t.identifier('i'),
                        true
                    )
                ),
            ]),
            ifMatch,
        ])
    );

    const guard = t.ifStatement(
        t.logicalExpression(
            '&&',
            t.identifier('bg'),
            t.memberExpression(t.identifier('bg'), t.identifier('pathname'))
        ),
        t.blockStatement([forStmt])
    );

    const mainDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('main'),
            t.callExpression(t.identifier('useRoutes'), [
                t.identifier('routes'),
                t.identifier('baseLoc'),
            ])
        ),
    ]);

    const overlayDecl = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier('overlay'),
            t.callExpression(t.identifier('useRoutes'), [
                t.logicalExpression(
                    '||',
                    t.identifier('overlayRoutes'),
                    t.identifier('__EMPTY_OVERLAY_ROUTES__')
                ),
                t.identifier('location'),
            ])
        ),
    ]);

    const ret = t.returnStatement(
        t.callExpression(t.identifier('createElement'), [
            t.memberExpression(t.identifier('React'), t.identifier('Fragment')),
            t.nullLiteral(),
            t.identifier('main'),
            t.identifier('overlay'),
        ])
    );

    const fn = t.functionDeclaration(
        t.identifier('__innerRouter__'),
        [],
        t.blockStatement([
            locationDecl,
            stateDecl,
            bgDecl,
            anySourceDecl,
            overlayRoutesDecl,
            baseLocDecl,
            guard,
            mainDecl,
            overlayDecl,
            ret,
        ])
    );

    return [emptyDecl, fn];
}

/**
 * Emits:
 *   export function AppRouter() {
 *     return createElement(BrowserRouter, null, createElement(__innerRouter__, null));
 *   }
 */
function buildInterceptModeAppRouter(): t.ExportNamedDeclaration {
    const fn = t.functionDeclaration(
        t.identifier('AppRouter'),
        [],
        t.blockStatement([
            t.returnStatement(
                t.callExpression(t.identifier('createElement'), [
                    t.identifier('BrowserRouter'),
                    t.nullLiteral(),
                    t.callExpression(t.identifier('createElement'), [
                        t.identifier('__innerRouter__'),
                        t.nullLiteral(),
                    ]),
                ])
            ),
        ])
    );
    return t.exportNamedDeclaration(fn);
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

    // Re-export runtime hooks from the virtual module so consumers can
    // `import { useSharedModule, useSlot, ... } from 'virtual:app-router'`
    // alongside AppRouter / useTemplateLink.
    statements.push(
        t.exportNamedDeclaration(
            null,
            [
                t.exportSpecifier(t.identifier('useSlot'), t.identifier('useSlot')),
                t.exportSpecifier(
                    t.identifier('useSharedModule'),
                    t.identifier('useSharedModule')
                ),
                t.exportSpecifier(
                    t.identifier('useSharedSlot'),
                    t.identifier('useSharedSlot')
                ),
                t.exportSpecifier(
                    t.identifier('useSharedProps'),
                    t.identifier('useSharedProps')
                ),
            ],
            t.stringLiteral('vite-plugin-react-app-router/runtime')
        )
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
