/**
 * Code generator for react-router-dom using AST
 * Generates the virtual module code that exports routes
 *
 * Uses nested routes for layouts, enabling efficient SPA navigation
 */

import * as t from '@babel/types';
import generate from '@babel/generator';
import type { ParsedRoute } from './types.ts';
import { pathToIdentifier } from './routeParser.ts';

export interface CodeGeneratorOptions {
    /** Project root directory (for relative imports) */
    rootDir: string;
    /** Whether to use lazy loading */
    lazy?: boolean;
}

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
 */
function createSuspenseWrapper(componentName: string, lazy: boolean): t.CallExpression {
    const fallback = createCreateElementCallExpression('div', t.nullLiteral(), [t.stringLiteral('Loading...')], true);

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
}

/**
 * Collects all necessary imports as AST nodes
 */
function collectImports(
    routes: ParsedRoute[],
    rootDir: string,
    lazy: boolean
): CollectedImports {
    const statements: t.Statement[] = [];
    const componentMap = new Map<string, string>();
    const layoutMap = new Map<string, string>();

    let pageIndex = 0;
    let layoutIndex = 0;
    const seenLayouts = new Set<string>();

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
    }

    return { statements, componentMap, layoutMap };
}

/**
 * Builds a nested route structure for a single route
 */
function buildRouteExpression(
    route: ParsedRoute,
    componentMap: Map<string, string>,
    layoutMap: Map<string, string>,
    lazy: boolean
): t.ObjectExpression {
    const pageName = componentMap.get(route.pagePath)!;
    const isIndex = route.pattern === '/';
    const path = isIndex ? '' : route.pattern.replace(/^\//, '');
    const pageElement = createSuspenseWrapper(pageName, lazy);

    // If there are inner layouts (more than just root), create nested structure
    if (route.layouts.length > 1) {
        // Build from innermost to outermost (excluding root layout)
        let innerRoute: t.ObjectExpression = isIndex
            ? createRouteObject([
                createRouteProperty('index', true),
                createRouteProperty('element', pageElement),
            ])
            : createRouteObject([
                createRouteProperty('path', t.stringLiteral(path)),
                createRouteProperty('element', pageElement),
            ]);

        // Wrap with inner layouts (from innermost to outermost, excluding root)
        for (let i = route.layouts.length - 1; i >= 1; i--) {
            const innerLayoutName = layoutMap.get(route.layouts[i]!)!;
            innerRoute = createRouteObject([
                createRouteProperty('element', createSuspenseWrapper(innerLayoutName, lazy)),
                createRouteProperty('children', t.arrayExpression([innerRoute])),
            ]);
        }

        return innerRoute;
    }

    // Simple route without nested layouts
    if (isIndex) {
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
 * Generates the complete routes module AST
 */
function generateRoutesAST(
    routes: ParsedRoute[],
    options: CodeGeneratorOptions
): t.Program {
    const { rootDir, lazy = true } = options;

    if (routes.length === 0) {
        return generateEmptyRoutesAST();
    }

    const { statements, componentMap, layoutMap } = collectImports(routes, rootDir, lazy);

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

    // Build route definitions array
    const routeDefinitions: t.ObjectExpression[] = [];

    // Routes with root layout
    for (const [rootLayoutPath, layoutRoutes] of routesByRootLayout) {
        const rootLayoutName = layoutMap.get(rootLayoutPath)!;
        const childRoutes = layoutRoutes.map((route) =>
            buildRouteExpression(route, componentMap, layoutMap, lazy)
        );

        routeDefinitions.push(
            createRouteObject([
                createRouteProperty('path', t.stringLiteral('/')),
                createRouteProperty('element', createSuspenseWrapper(rootLayoutName, lazy)),
                createRouteProperty('children', t.arrayExpression(childRoutes)),
            ])
        );
    }

    // Routes without layout
    for (const route of routesWithoutLayout) {
        const pageName = componentMap.get(route.pagePath)!;
        routeDefinitions.push(
            createRouteObject([
                createRouteProperty('path', t.stringLiteral(route.pattern)),
                createRouteProperty('element', createSuspenseWrapper(pageName, lazy)),
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
