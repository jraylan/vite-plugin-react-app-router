/**
 * Turns a fixture app directory into the route table the consumer's router
 * would actually receive.
 *
 * The generated virtual module is real JavaScript with imports of user files
 * and React elements, so it cannot simply be imported here. Instead we slice
 * the `const routes = [...]` literal out of the generated source and evaluate
 * just that expression with every free identifier bound to an inert stub. The
 * result is the real nested array of route objects — same `path`, `index` and
 * `children` react-router sees at runtime — with element expressions replaced
 * by placeholders that no assertion looks at.
 */

import * as path from 'path';
import {
    parseAppRouter,
    generateBuildRoutesCode,
    generateDevRoutesCode,
    type CodeGeneratorOptions,
    type ParsedRoute,
} from '../../src/commons/index.js';

export interface RouteEntry {
    path?: string;
    index?: boolean;
    children?: RouteEntry[];
    element?: unknown;
    errorElement?: unknown;
}

/**
 * Anything the generated code references but a route table does not need:
 * `createElement`, `Suspense`, the lazy page components, `React.Fragment`, ...
 * Callable, constructable, and infinitely property-chainable so no expression
 * in the emitted module can blow up while we evaluate it.
 */
const stub: any = new Proxy(function () { /* stub */ } as any, {
    get: (_target, key) => (key === 'then' ? undefined : stub),
    apply: () => stub,
    construct: () => stub,
});

/** Scope object for the `with` block: every free identifier resolves to `stub`. */
const stubScope = new Proxy({} as Record<PropertyKey, unknown>, {
    // `has` must be true for `with` to capture the identifier, but
    // Symbol.unscopables has to stay undefined or the whole block is skipped.
    has: () => true,
    get: (_target, key) => (key === Symbol.unscopables ? undefined : stub),
});

/**
 * Returns the source of the balanced bracket group starting at `start`,
 * skipping over string literals so a `"[" `inside a path never unbalances it.
 */
function sliceBalanced(code: string, start: number): string {
    const closerFor: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
    const stack: string[] = [];
    let quote: string | null = null;

    for (let i = start; i < code.length; i++) {
        const ch = code[i]!;

        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        const closer = closerFor[ch];
        if (closer) {
            stack.push(closer);
            continue;
        }
        if (ch === ']' || ch === '}' || ch === ')') {
            const expected = stack.pop();
            if (expected !== ch) {
                throw new Error(`unbalanced "${ch}" at offset ${i} of generated code`);
            }
            if (stack.length === 0) return code.slice(start, i + 1);
        }
    }
    throw new Error('unterminated route array in generated code');
}

/** Evaluates the `const routes = [...]` literal of a generated module. */
export function extractRouteTable(code: string): RouteEntry[] {
    const marker = /(?:^|\n)const routes = /;
    const match = marker.exec(code);
    if (!match) throw new Error('generated code has no `const routes = ` declaration');

    const arrayStart = code.indexOf('[', match.index + match[0].length - 1);
    if (arrayStart === -1) throw new Error('`const routes` is not an array literal');

    const literal = sliceBalanced(code, arrayStart);
    // eslint-disable-next-line no-new-func
    const evaluate = new Function('scope', `with (scope) { return ${literal}; }`);
    return evaluate(stubScope) as RouteEntry[];
}

/** Mirrors how `src/build` and `src/server` call the generator. */
function generatorOptions(appDir: string): {
    routes: ParsedRoute[];
    options: CodeGeneratorOptions;
} {
    const parsed = parseAppRouter({ appDir, lazy: false });
    return {
        routes: parsed.routes,
        options: {
            rootDir: path.dirname(appDir),
            lazy: false,
            rootNotFound: parsed.rootNotFound,
            intercepts: parsed.intercepts,
            tree: parsed.tree,
            rootLayout: parsed.rootLayout,
            rootPage: parsed.rootPage,
            rootError: parsed.rootError,
            rootLoading: parsed.rootLoading,
            rootSlots: parsed.rootSlots,
        },
    };
}

/** Generated module source for build mode and dev mode, from one parse. */
export function generateBothModes(appDir: string): { build: string; dev: string } {
    const { routes, options } = generatorOptions(appDir);
    return {
        build: generateBuildRoutesCode(routes, options),
        dev: generateDevRoutesCode(routes, options),
    };
}

/** The route table a consumer of this fixture would get at runtime. */
export function buildRouteTable(appDir: string): RouteEntry[] {
    return extractRouteTable(generateBothModes(appDir).build);
}

/** Route table produced by the legacy flat path (no `tree` passed). */
export function buildLegacyRouteTable(appDir: string): RouteEntry[] {
    const parsed = parseAppRouter({ appDir, lazy: false });
    const code = generateBuildRoutesCode(parsed.routes, {
        rootDir: path.dirname(appDir),
        lazy: false,
        rootNotFound: parsed.rootNotFound,
    });
    return extractRouteTable(code);
}

/** Depth-first walk over the table, handing each route its ancestor chain. */
export function walkRoutes(
    routes: RouteEntry[],
    visit: (route: RouteEntry, ancestors: RouteEntry[]) => void,
    ancestors: RouteEntry[] = []
): void {
    for (const route of routes) {
        visit(route, ancestors);
        if (route.children) walkRoutes(route.children, visit, [...ancestors, route]);
    }
}

/** How a matched chain reads in a failure message. */
export function describeRoute(route: RouteEntry): string {
    if (typeof route.path === 'string') return route.path === '' ? "''" : route.path;
    if (route.index) return '(index)';
    return '(pathless)';
}

/** Every `path: '*'` route that hangs under an ancestor without a path. */
export function starRoutesUnderPathlessParent(routes: RouteEntry[]): string[] {
    const offenders: string[] = [];
    walkRoutes(routes, (route, ancestors) => {
        if (route.path !== '*') return;
        if (ancestors.every((a) => typeof a.path === 'string')) return;
        offenders.push([...ancestors, route].map(describeRoute).join(' > '));
    });
    return offenders;
}
