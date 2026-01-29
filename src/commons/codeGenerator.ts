/**
 * Code generator for react-router-dom using AST
 * Generates the virtual module code that exports routes
 *
 * Uses nested routes for layouts, enabling efficient SPA navigation
 */

import * as t from '@babel/types';
import _generate from '@babel/generator';
import type { ParsedRoute } from './types.js';
import { pathToIdentifier } from './routeParser.js';

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
    rootNotFound?: string
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

    // Import from react-router-dom
    statements.push(
        createImportDeclaration(
            [
                createNamedImport('createBrowserRouter'),
                createNamedImport('RouterProvider'),
                createNamedImport('Outlet'),
            ],
            'react-router-dom'
        )
    );

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

    const pageElement = createSuspenseWrapper(pageName, lazy, loadingName);

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
}

/**
 * Generates the complete routes module AST
 */
function generateRoutesAST(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): t.Program {
    const { rootDir, lazy = true, rootNotFound } = options;

    if (routes.length === 0) {
        return generateEmptyRoutesAST();
    }

    const { statements, componentMap, layoutMap, loadingMap, errorMap, notFoundMap } = collectImports(routes, rootDir, lazy, rootNotFound);

    // Group routes by root layout
    const routesByRootLayout = new Map<string, ParsedRoute[]>();
    const routesWithoutLayout: ParsedRoute[] = [];

    for (const route of routes) {
        if (route.layouts.length > 0) {
            const rootLayout = route.layouts[0]!;
            if (!routesByRootLayout.has(rootLayout)) {
                routesByRootLayout.set(rootLayout, []);
            }
            routesByRootLayout.get(rootLayout)!.push(route);
        } else {
            routesWithoutLayout.push(route);
        }
    }

    // Find the most common root loading/error components for the root layout
    const findRootContextComponents = (layoutRoutes: ParsedRoute[]) => {
        // Use the first route's loading/error as root context (typically inherited from root)
        const firstRoute = layoutRoutes[0];
        return {
            loadingPath: firstRoute?.loadingPath,
            errorPath: firstRoute?.errorPath,
        };
    };

    // Build route definitions array
    const routeDefinitions: t.ObjectExpression[] = [];

    // Routes with root layout
    for (const [rootLayoutPath, layoutRoutes] of routesByRootLayout) {
        const rootLayoutName = layoutMap.get(rootLayoutPath)!;
        const rootContext = findRootContextComponents(layoutRoutes);
        const rootLoadingName = rootContext.loadingPath ? loadingMap.get(rootContext.loadingPath) : undefined;
        const rootErrorName = rootContext.errorPath ? errorMap.get(rootContext.errorPath) : undefined;

        const childRoutes = layoutRoutes.map((route) =>
            buildRouteExpression(route, componentMap, layoutMap, loadingMap, errorMap, notFoundMap, lazy)
        );

        const rootRouteProps: t.ObjectProperty[] = [
            createRouteProperty('path', t.stringLiteral('/')),
            createRouteProperty('element', createSuspenseWrapper(rootLayoutName, lazy, rootLoadingName)),
            createRouteProperty('children', t.arrayExpression(childRoutes)),
        ];

        // Add errorElement to root layout if exists
        if (rootErrorName) {
            rootRouteProps.push(
                createRouteProperty('errorElement', createCreateElementCallExpression(rootErrorName, t.nullLiteral(), []))
            );
        }

        routeDefinitions.push(createRouteObject(rootRouteProps));
    }

    // Routes without layout
    for (const route of routesWithoutLayout) {
        const pageName = componentMap.get(route.pagePath)!;
        const loadingName = route.loadingPath ? loadingMap.get(route.loadingPath) : undefined;
        const errorName = route.errorPath ? errorMap.get(route.errorPath) : undefined;

        const routeProps: t.ObjectProperty[] = [
            createRouteProperty('path', t.stringLiteral(route.pattern)),
            createRouteProperty('element', createSuspenseWrapper(pageName, lazy, loadingName)),
        ];

        if (errorName) {
            routeProps.push(
                createRouteProperty('errorElement', createCreateElementCallExpression(errorName, t.nullLiteral(), []))
            );
        }

        routeDefinitions.push(createRouteObject(routeProps));
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
    return output.code;
}

/**
 * Generates optimized code for build (tree-shaking friendly)
 */
export function generateBuildRoutesCode(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): string {
    return generateRoutesCode(routes, { ...options, lazy: false });
}

/**
 * Generates code for development (with lazy loading and HMR friendly)
 */
export function generateDevRoutesCode(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): string {
    return generateRoutesCode(routes, { ...options, lazy: true });
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
