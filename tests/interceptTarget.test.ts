/**
 * Which intercepts the generator keeps.
 *
 * An intercept entry is rooted at the marker directory (`feed/(..)photo/` →
 * target `/photo`). At runtime the overlay matches that target with
 * `end: false` and runs its own route table, so the target segment itself
 * needs no page: the README example pairs `feed/(..)photo/[id]/` with
 * `photo/[id]/page.tsx` only. The generator must keep that intercept, and
 * still drop one with no canonical page anywhere under its target.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as path from 'path';
import { generateRoutesCode, parseAppRouter } from '../src/commons/index.js';
import { cleanupAppDirs, createAppDir } from './helpers/appTree.js';

afterAll(() => {
    cleanupAppDirs();
});

function generateFor(files: string[]): string {
    const appDir = createAppDir(files);
    const parsed = parseAppRouter({ appDir, lazy: false });
    return generateRoutesCode(parsed.routes, {
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
    });
}

/** Targets of the intercept entries emitted into `__intercepts__`. */
function emittedTargets(code: string): string[] {
    return [...code.matchAll(/target:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

describe('intercept target validation', () => {
    let warnings: string[];
    const originalWarn = console.warn;

    beforeEach(() => {
        warnings = [];
        console.warn = (...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        };
    });

    afterEach(() => {
        console.warn = originalWarn;
    });

    test('README example: canonical only below the target is enough', () => {
        const code = generateFor([
            'layout.tsx',
            'page.tsx',
            'feed/page.tsx',
            'feed/(..)photo/[id]/page.tsx',
            'photo/[id]/page.tsx',
        ]);
        expect(emittedTargets(code)).toEqual(['/photo']);
        expect(code).toContain('BrowserRouter');
        expect(warnings).toEqual([]);
    });

    test('a page exactly at the target still works', () => {
        const code = generateFor([
            'layout.tsx',
            'page.tsx',
            'feed/page.tsx',
            'feed/(..)photo/page.tsx',
            'photo/page.tsx',
        ]);
        expect(emittedTargets(code)).toEqual(['/photo']);
        expect(warnings).toEqual([]);
    });

    test('no canonical page under the target: dropped with a warning', () => {
        const code = generateFor([
            'layout.tsx',
            'page.tsx',
            'feed/page.tsx',
            'feed/(..)photo/[id]/page.tsx',
        ]);
        expect(emittedTargets(code)).toEqual([]);
        // No intercept survives, so the regular data router is emitted.
        expect(code).toContain('createBrowserRouter');
        expect(code).not.toMatch(/\bBrowserRouter\b/);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('"/photo"');
    });

    test('a sibling segment with a common prefix does not count', () => {
        // `/photos` is not under `/photo`.
        const code = generateFor([
            'layout.tsx',
            'page.tsx',
            'feed/page.tsx',
            'feed/(..)photo/[id]/page.tsx',
            'photos/[id]/page.tsx',
        ]);
        expect(emittedTargets(code)).toEqual([]);
        expect(warnings.length).toBe(1);
    });
});
