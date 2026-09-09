/**
 * What a lazy route shows while its chunk is in flight.
 *
 * Every lazily loaded page, layout, not-found and parallel-route default is
 * emitted inside a `<Suspense>`, so each one needs a fallback. Two rules
 * govern which fallback it gets, and both are asserted against the real
 * generated module rather than against the shape of the emitted objects:
 *
 * 1. With no `loading.tsx` in scope the fallback renders nothing. A router
 *    must not paint copy into someone's app — the fallback used to be a
 *    hardcoded `<div>Loading...</div>`, which shipped untranslated English
 *    into every locale, unstyled and unthemeable, once per lazy route.
 *
 * 2. A `loading.tsx` covers everything the segment renders, which includes
 *    the parts that used to be skipped: the segment's `not-found.tsx`, a
 *    parallel route's `default.tsx`, and — at the root, where there is no
 *    ancestor to inherit from — the root layout itself.
 *
 * The assertions read the generated source because the fallback lives in an
 * element expression, and the route-table helper replaces those with stubs.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import * as path from 'path';
import { cleanupAppDirs, createAppDir } from './helpers/appTree.js';
import {
    parseAppRouter,
    generateBuildRoutesCode,
} from '../src/commons/index.js';

afterAll(() => {
    cleanupAppDirs();
});

/**
 * Generated module for a fixture, in lazy mode.
 *
 * Lazy mode is the point: `createSuspenseWrapper` only emits a boundary when
 * chunks are split, so an eager build has no fallback to assert on.
 */
function generateLazy(files: string[]): string {
    const appDir = createAppDir(files);
    const parsed = parseAppRouter({ appDir, lazy: true });
    return generateBuildRoutesCode(parsed.routes, {
        rootDir: path.dirname(appDir),
        lazy: true,
        rootNotFound: parsed.rootNotFound,
        intercepts: parsed.intercepts,
        tree: parsed.tree,
        rootLayout: parsed.rootLayout,
        rootPage: parsed.rootPage,
        rootError: parsed.rootError,
        rootLoading: parsed.rootLoading,
        rootSlots: parsed.rootSlots,
    });
}

/** How many Suspense boundaries were left with nothing to show. */
function emptyFallbacks(code: string): number {
    return code.match(/fallback:\s*null/g)?.length ?? 0;
}

/** How many Suspense boundaries point at a loading component. */
function servedFallbacks(code: string): number {
    return code.match(/fallback:\s*createElement\(Loading\w*/g)?.length ?? 0;
}

describe('fallback without a loading.tsx', () => {
    test('renders nothing instead of English copy', () => {
        const code = generateLazy([
            'layout.tsx',
            'page.tsx',
            'not-found.tsx',
            'dashboard/layout.tsx',
            'dashboard/page.tsx',
            'dashboard/not-found.tsx',
        ]);

        expect(code).not.toContain('Loading...');
        expect(code).not.toMatch(/fallback:\s*createElement\("div"/);
        expect(emptyFallbacks(code)).toBeGreaterThan(0);
        expect(servedFallbacks(code)).toBe(0);
    });
});

describe('a loading.tsx at the root', () => {
    /*
     * The strong form of rule 2: one file at the root and no boundary is left
     * unattended. It covers every call site at once — the root layout, the
     * pages, a segment's not-found and the root not-found — which is how
     * three of them were found missing in the first place.
     */
    test('leaves no Suspense unattended', () => {
        const code = generateLazy([
            'layout.tsx',
            'loading.tsx',
            'page.tsx',
            'not-found.tsx',
            'dashboard/layout.tsx',
            'dashboard/page.tsx',
            'dashboard/not-found.tsx',
        ]);

        expect(emptyFallbacks(code)).toBe(0);
        expect(servedFallbacks(code)).toBeGreaterThan(0);
    });

    test('covers the root layout, which has no ancestor to inherit from', () => {
        const code = generateLazy(['layout.tsx', 'loading.tsx', 'page.tsx']);

        const rootElement =
            /path:\s*"\/"[\s\S]{0,200}?fallback:\s*(null|createElement\(Loading\w*)/
                .exec(code);
        expect(rootElement).not.toBeNull();
        expect(rootElement![1]).not.toBe('null');
    });
});

describe('a loading.tsx in a segment', () => {
    test('covers that segment without covering its siblings', () => {
        const code = generateLazy([
            'layout.tsx',
            'page.tsx',
            'dashboard/layout.tsx',
            'dashboard/loading.tsx',
            'dashboard/page.tsx',
            'dashboard/not-found.tsx',
            'reports/page.tsx',
        ]);

        // The segment that declares it is served; the root and the sibling
        // segment, with nothing in scope, stay on the empty fallback.
        expect(servedFallbacks(code)).toBeGreaterThan(0);
        expect(emptyFallbacks(code)).toBeGreaterThan(0);
    });
});
