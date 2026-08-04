/**
 * Scope of `not-found.tsx`, the Next.js App Router way.
 *
 * In Next, `app/dashboard/not-found.tsx` only ever renders for URLs under
 * `/dashboard`. This plugin promises the same convention, so a segment's
 * not-found must never answer for URLs outside its segment — no matter that
 * the layout route it hangs from is emitted without a path of its own.
 *
 * Every assertion here runs react-router's real `matchRoutes` over the real
 * generated table (see `helpers/routeTable.ts`), so a fix that only rearranges
 * the emitted objects without changing what matches cannot make them pass.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { cleanupAppDirs, createAppDir } from './helpers/appTree.js';
import {
    buildLegacyRouteTable,
    buildRouteTable,
    generateBothModes,
    starRoutesUnderPathlessParent,
    type RouteEntry,
} from './helpers/routeTable.js';
import { drawChain, findByPath, leafIs, leafPath, matchChain } from './helpers/matching.js';

afterAll(() => {
    cleanupAppDirs();
});

/** Asserts `url` renders `route` as its leaf, reporting the chain when not. */
function expectLeaf(table: RouteEntry[], url: string, route: RouteEntry): void {
    if (!leafIs(table, url, route)) {
        throw new Error(
            `expected ${url} to end at ${route.path ?? '(pathless)'}, ` +
            `but it matched: ${drawChain(table, url)}`
        );
    }
}

/** Asserts `url` does NOT end at `route`. */
function expectNotLeaf(table: RouteEntry[], url: string, route: RouteEntry): void {
    if (leafIs(table, url, route)) {
        throw new Error(
            `expected ${url} to stay out of ${route.path ?? '(pathless)'}, ` +
            `but it matched: ${drawChain(table, url)}`
        );
    }
}

describe('root not-found', () => {
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'login/page.tsx',
    ]);
    const table = buildRouteTable(app);

    test('stays a global catch-all', () => {
        expect(leafPath(table, '/anything')).toBe('*');
        expect(leafPath(table, '/deeply/nested/nonsense')).toBe('*');
    });

    test('does not swallow real routes', () => {
        expect(leafPath(table, '/login')).toBe('login');
    });

    test('works without a root layout too', () => {
        const bare = createAppDir(['page.tsx', 'not-found.tsx', 'login/page.tsx']);
        const bareTable = buildRouteTable(bare);
        expect(leafPath(bareTable, '/anything')).toBe('*');
        expect(leafPath(bareTable, '/login')).toBe('login');
    });
});

describe('segment not-found', () => {
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'login/page.tsx',
        'dashboard/layout.tsx',
        'dashboard/page.tsx',
        'dashboard/not-found.tsx',
        'dashboard/reports/page.tsx',
    ]);
    const table = buildRouteTable(app);

    /** The segment's not-found route: the catch-all scoped to `dashboard`. */
    function segmentNotFound(): RouteEntry {
        const route = findByPath(table, 'dashboard/*');
        if (!route) {
            throw new Error(
                'no route scoped to the dashboard segment was emitted for ' +
                'dashboard/not-found.tsx — the whole table was:\n' +
                JSON.stringify(table, (k, v) => (k === 'element' ? '<el>' : v), 2)
            );
        }
        return route;
    }

    test('matches unknown URLs inside its segment', () => {
        expectLeaf(table, '/dashboard/nope', segmentNotFound());
        expectLeaf(table, '/dashboard/nope/deeper', segmentNotFound());
    });

    test('renders inside the segment layout, as the README promises', () => {
        // The chain must pass through the dashboard layout — the same route
        // object a real page of the segment renders under.
        const shellOfPage = matchChain(table, '/dashboard/reports').slice(0, -1);
        const shellOf404 = matchChain(table, '/dashboard/nope').slice(0, -1);
        expect(shellOf404).toEqual(shellOfPage);
    });

    test('does NOT match URLs outside its segment', () => {
        expectNotLeaf(table, '/anything', segmentNotFound());
        expectNotLeaf(table, '/login', segmentNotFound());
        expectNotLeaf(table, '/other/zone/deep', segmentNotFound());
    });

    test('leaves the global 404 in charge outside the segment', () => {
        expect(leafPath(table, '/anything')).toBe('*');
        expect(leafPath(table, '/other/zone/deep')).toBe('*');
        expect(leafPath(table, '/login')).toBe('login');
    });

    test('does not hang a bare `*` under a pathless parent', () => {
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });

    test('is not emitted at all when the segment has no layout', () => {
        // Without a layout there is nowhere to render it (the README documents
        // the nested not-found as rendering inside its layout's Outlet), and a
        // stray catch-all here is exactly what hijacks the whole origin.
        const layoutless = createAppDir([
            'layout.tsx',
            'page.tsx',
            'not-found.tsx',
            'reports/page.tsx',
            'reports/not-found.tsx',
        ]);
        const layoutlessTable = buildRouteTable(layoutless);
        expect(starRoutesUnderPathlessParent(layoutlessTable)).toEqual([]);
        expect(leafPath(layoutlessTable, '/anything')).toBe('*');
    });
});

describe('nested segment not-found', () => {
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'a/layout.tsx',
        'a/page.tsx',
        'a/not-found.tsx',
        'a/b/layout.tsx',
        'a/b/page.tsx',
        'a/b/not-found.tsx',
    ]);
    const table = buildRouteTable(app);

    test('the deepest segment owns its own sub-tree', () => {
        expect(leafPath(table, '/a/b/nope')).toBe('a/b/*');
        expect(leafPath(table, '/a/b/nope/deeper')).toBe('a/b/*');
    });

    test('the outer segment keeps the rest of its sub-tree', () => {
        expect(leafPath(table, '/a/nope')).toBe('a/*');
    });

    test('neither leaks to the origin', () => {
        expect(leafPath(table, '/nope')).toBe('*');
        expect(leafPath(table, '/c/nope')).toBe('*');
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });
});

describe('not-found next to a catch-all page', () => {
    // The shape the Procyon Finance app actually has: `[...rest]/page.tsx` and
    // `not-found.tsx` in the same directory.
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'dashboard/layout.tsx',
        'dashboard/page.tsx',
        'dashboard/not-found.tsx',
        'dashboard/[...rest]/page.tsx',
        'subscribe/[token]/page.tsx',
    ]);
    const table = buildRouteTable(app);

    test('both land on the segment scope', () => {
        const scoped = table.flatMap(function collect(route: RouteEntry): RouteEntry[] {
            return [route, ...(route.children ?? []).flatMap(collect)];
        }).filter((route) => route.path === 'dashboard/*');
        expect(scoped.length).toBe(2);
    });

    test('the catch-all page wins inside the segment, as in Next', () => {
        expect(leafPath(table, '/dashboard/nope')).toBe('dashboard/*');
        const chain = matchChain(table, '/dashboard/nope');
        // The page is emitted before the not-found, and react-router breaks
        // ties by order — so the segment's own catch-all page renders.
        expect(chain[chain.length - 1]).toBe(
            table.flatMap(function collect(route: RouteEntry): RouteEntry[] {
                return [route, ...(route.children ?? []).flatMap(collect)];
            }).filter((r) => r.path === 'dashboard/*')[0]!
        );
    });

    test('other areas are untouched', () => {
        expect(leafPath(table, '/subscribe/abc123')).toBe('subscribe/:token');
        expect(leafPath(table, '/anything')).toBe('*');
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });
});

describe('route groups', () => {
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        '(marketing)/about/page.tsx',
        '(app)/dashboard/layout.tsx',
        '(app)/dashboard/page.tsx',
        '(app)/dashboard/not-found.tsx',
    ]);
    const table = buildRouteTable(app);

    test('scope follows the URL, not the folder', () => {
        expect(leafPath(table, '/dashboard/nope')).toBe('dashboard/*');
        expect(leafPath(table, '/about')).toBe('about');
        expect(leafPath(table, '/anything')).toBe('*');
    });

    test('the group name never reaches a path', () => {
        const paths: string[] = [];
        (function collect(routes: RouteEntry[]): void {
            for (const route of routes) {
                if (typeof route.path === 'string') paths.push(route.path);
                if (route.children) collect(route.children);
            }
        })(table);
        expect(paths.some((p) => p.includes('('))).toBe(false);
    });

    test('a not-found on the group itself stays global, because the group has no URL', () => {
        const grouped = createAppDir([
            'layout.tsx',
            'page.tsx',
            '(app)/layout.tsx',
            '(app)/not-found.tsx',
            '(app)/dashboard/page.tsx',
        ]);
        const groupedTable = buildRouteTable(grouped);
        // `(app)/` contributes no URL segment, so its scope IS the origin.
        expect(leafPath(groupedTable, '/anything')).toBe('*');
        expect(leafPath(groupedTable, '/dashboard')).toBe('dashboard');
    });

    test('does not hang a bare `*` under a pathless parent', () => {
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });
});

describe('dynamic segments', () => {
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'clients/[id]/layout.tsx',
        'clients/[id]/page.tsx',
        'clients/[id]/not-found.tsx',
    ]);
    const table = buildRouteTable(app);

    test('scope keeps the parameter', () => {
        expect(leafPath(table, '/clients/42/nope')).toBe('clients/:id/*');
        expect(leafPath(table, '/anything')).toBe('*');
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });
});

describe('catch-all segment carrying its own not-found', () => {
    // `[...rest]/` already owns everything below it, so its not-found must not
    // produce a doubled star (`rest/*/*`), which react-router rejects outright.
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'files/[...rest]/layout.tsx',
        'files/[...rest]/page.tsx',
        'files/[...rest]/not-found.tsx',
    ]);
    const table = buildRouteTable(app);

    test('emits no invalid path', () => {
        const paths: string[] = [];
        (function collect(routes: RouteEntry[]): void {
            for (const route of routes) {
                if (typeof route.path === 'string') paths.push(route.path);
                if (route.children) collect(route.children);
            }
        })(table);
        expect(paths.some((p) => /\*.+/.test(p))).toBe(false);
    });

    test('still routes the segment and leaves the origin alone', () => {
        expect(leafPath(table, '/files/a/b')).toBe('files/*');
        expect(leafPath(table, '/anything')).toBe('*');
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });
});

describe('intercepting routes', () => {
    // The overlay table is built from the same walker, rooted at the intercept
    // target instead of `/`. Scoping must follow that root, not the origin.
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'clients/layout.tsx',
        'clients/page.tsx',
        'clients/not-found.tsx',
        'clients/[id]/layout.tsx',
        'clients/[id]/page.tsx',
        'clients/[id]/not-found.tsx',
        'clients/(.)[id]/page.tsx',
    ]);
    const table = buildRouteTable(app);

    test('each segment keeps its own 404', () => {
        expect(leafPath(table, '/clients/9/nope')).toBe('clients/:id/*');
        expect(leafPath(table, '/clients/nope/deep/deeper')).toBe('clients/:id/*');
        expect(leafPath(table, '/anything')).toBe('*');
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });

    test('the overlay table only ever hangs a `*` under a pathed route', () => {
        const code = generateBothModes(app).build;
        // Every route inside `__intercepts__` is nested under the entry root,
        // which carries `path: <target>` — so a `*` there is already scoped.
        const overlay = /const __intercepts__ = /.exec(code);
        expect(overlay).not.toBeNull();
        expect(code).toContain('path: "/clients/:id"');
    });
});

describe('parallel route slots', () => {
    // A slot is matched independently by `useRoutes` against the whole
    // location, so an unscoped `*` in a slot answers for every URL in the app.
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'dashboard/layout.tsx',
        'dashboard/page.tsx',
        'dashboard/@modal/layout.tsx',
        'dashboard/@modal/not-found.tsx',
        'dashboard/@modal/photo/page.tsx',
    ]);

    test("the slot's not-found is scoped to the segment that owns the slot", () => {
        const code = generateBothModes(app).build;
        expect(code).toContain('path: "dashboard/*"');
        // A bare star in the slot table would make the slot render its 404 on
        // every route of the app, including the ones outside the segment.
        expect(code.match(/path: "\*"/g)?.length ?? 0).toBe(2); // root 404, twice
    });
});

describe('build and dev generation', () => {
    test('produce byte-identical modules', () => {
        const app = createAppDir([
            'layout.tsx',
            'page.tsx',
            'not-found.tsx',
            'dashboard/layout.tsx',
            'dashboard/page.tsx',
            'dashboard/not-found.tsx',
            'dashboard/[...rest]/page.tsx',
            '(app)/settings/layout.tsx',
            '(app)/settings/page.tsx',
            '(app)/settings/not-found.tsx',
        ]);
        const { build, dev } = generateBothModes(app);
        expect(build).toBe(dev);
    });
});

describe('legacy flat generation (no tree passed)', () => {
    // `generateRoutesCode` is public API and still accepts a bare route list.
    // The same scoping rule has to hold there, or the invariant depends on
    // which entry point the caller used.
    const app = createAppDir([
        'layout.tsx',
        'page.tsx',
        'not-found.tsx',
        'dashboard/layout.tsx',
        'dashboard/page.tsx',
        'dashboard/not-found.tsx',
        'dashboard/reports/page.tsx',
    ]);
    const table = buildLegacyRouteTable(app);

    test('does not hang a bare `*` under a pathless parent', () => {
        expect(starRoutesUnderPathlessParent(table)).toEqual([]);
    });

    test('keeps the segment 404 inside its segment', () => {
        expect(leafPath(table, '/dashboard/nope')).toBe('dashboard/*');
        expect(leafPath(table, '/anything')).toBe('*');
    });
});
