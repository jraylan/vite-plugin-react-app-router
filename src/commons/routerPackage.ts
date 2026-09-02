/**
 * Resolves which React Router package the generated code should import from.
 *
 * React Router 8 removed the `react-router-dom` package: everything now comes
 * from `react-router`, except `RouterProvider`/`HydratedRouter`, which live in
 * `react-router/dom`. React Router 7 already shipped that layout while keeping
 * `react-router-dom` as a compatibility shim, and React Router 6 only exposes
 * the DOM APIs (`BrowserRouter`, `createBrowserRouter`, `RouterProvider`, ...)
 * through `react-router-dom`.
 *
 * The generator therefore needs two module specifiers:
 *   - `core`: where `Outlet`, `useRoutes`, `createBrowserRouter`, ... come from
 *   - `dom`:  where `RouterProvider` comes from
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * How the plugin should pick the router package.
 *   - `'auto'` (default): inspect the project's `node_modules`
 *   - `'react-router-dom'`: always emit `react-router-dom` imports (v6/v7)
 *   - `'react-router'`: always emit `react-router` + `react-router/dom` (v7/v8)
 */
export type RouterPackagePreference = 'auto' | 'react-router-dom' | 'react-router';

export interface RouterPackage {
    /** Module specifier for the generic exports (`Outlet`, `useRoutes`, ...). */
    core: string;
    /** Module specifier for `RouterProvider`. */
    dom: string;
    /** Major version of the package behind `core`, when it could be read. */
    major: number | null;
}

/** Imports the way the plugin always emitted them: everything from `react-router-dom`. */
export const REACT_ROUTER_DOM_PACKAGE: RouterPackage = Object.freeze({
    core: 'react-router-dom',
    dom: 'react-router-dom',
    major: null,
});

/** Imports for React Router 7+ without the compatibility shim, and for React Router 8. */
export const REACT_ROUTER_PACKAGE: RouterPackage = Object.freeze({
    core: 'react-router',
    dom: 'react-router/dom',
    major: null,
});

interface InstalledPackage {
    version: string;
    major: number | null;
}

function parseMajor(version: string): number | null {
    const match = /^(\d+)\./.exec(version);
    return match ? Number(match[1]) : null;
}

/**
 * Finds the `package.json` of `name` as seen from `rootDir`, walking up the
 * directory tree exactly like Node would for an import issued by a file in
 * `rootDir`. Returns `null` when the package is not installed.
 */
function findInstalledPackage(rootDir: string, name: string): InstalledPackage | null {
    const require = createRequire(path.join(rootDir, '__vite-plugin-react-app-router__.js'));

    let packageJsonPath: string | undefined;
    try {
        // Works for every version that exports `./package.json` (v7+) and for
        // packages without an `exports` map at all (v6).
        packageJsonPath = require.resolve(`${name}/package.json`);
    } catch {
        // The package may exist but hide `package.json` behind its `exports`
        // map: resolve the entry point instead and walk up to the package root.
        let entry: string;
        try {
            entry = require.resolve(name);
        } catch {
            return null;
        }
        let dir = path.dirname(entry);
        while (true) {
            const candidate = path.join(dir, 'package.json');
            if (fs.existsSync(candidate)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string };
                    if (parsed.name === name) {
                        packageJsonPath = candidate;
                        break;
                    }
                } catch {
                    // Malformed package.json on the way up: keep climbing.
                }
            }
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        if (!packageJsonPath) return null;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
        const version = typeof parsed.version === 'string' ? parsed.version : '';
        return { version, major: parseMajor(version) };
    } catch {
        return { version: '', major: null };
    }
}

const cache = new Map<string, RouterPackage>();

/**
 * Picks the router package for a project.
 *
 * Auto-detection order:
 *   1. `react-router` >= 8 installed → `react-router` (+ `react-router/dom`).
 *      Wins even when a stale `react-router-dom` is still around, because the
 *      app code has to import from `react-router` on v8 and mixing the two
 *      would create two router contexts.
 *   2. `react-router-dom` installed → `react-router-dom` (v6/v7, unchanged
 *      behaviour).
 *   3. `react-router` >= 7 installed → `react-router` (+ `react-router/dom`).
 *   4. Nothing usable → `react-router-dom`, with a warning.
 *
 * Results are cached per `rootDir` + preference: the dev server regenerates
 * the virtual module on every route change and the installed packages do not
 * move in between.
 */
export function resolveRouterPackage(
    rootDir: string,
    preference: RouterPackagePreference = 'auto'
): RouterPackage {
    if (preference === 'react-router-dom') return REACT_ROUTER_DOM_PACKAGE;
    if (preference === 'react-router') return REACT_ROUTER_PACKAGE;

    const key = path.resolve(rootDir);
    const cached = cache.get(key);
    if (cached) return cached;

    const resolved = detectRouterPackage(key);
    cache.set(key, resolved);
    return resolved;
}

function detectRouterPackage(rootDir: string): RouterPackage {
    const core = findInstalledPackage(rootDir, 'react-router');
    const dom = findInstalledPackage(rootDir, 'react-router-dom');

    if (core && core.major !== null && core.major >= 8) {
        if (dom) {
            console.warn(
                `[vite-plugin-react-app-router] react-router@${core.version} is installed ` +
                `alongside react-router-dom@${dom.version}. React Router 8 dropped ` +
                `react-router-dom; generated routes will import from "react-router". ` +
                `Remove react-router-dom and update your own imports to avoid two router contexts.`
            );
        }
        return { ...REACT_ROUTER_PACKAGE, major: core.major };
    }

    if (dom) {
        return { ...REACT_ROUTER_DOM_PACKAGE, major: dom.major };
    }

    if (core && core.major !== null && core.major >= 7) {
        return { ...REACT_ROUTER_PACKAGE, major: core.major };
    }

    if (core) {
        console.warn(
            `[vite-plugin-react-app-router] Only react-router@${core.version} was found. ` +
            `React Router 6 exposes the DOM APIs through react-router-dom; install it ` +
            `(or upgrade to react-router@7+). Falling back to "react-router-dom" imports.`
        );
        return { ...REACT_ROUTER_DOM_PACKAGE, major: core.major };
    }

    console.warn(
        `[vite-plugin-react-app-router] Could not find react-router or react-router-dom ` +
        `from ${rootDir}. Install "react-router" (v7/v8) or "react-router-dom" (v6/v7). ` +
        `Falling back to "react-router-dom" imports.`
    );
    return REACT_ROUTER_DOM_PACKAGE;
}

/** Test hook: forgets cached detections so fixtures can be re-resolved. */
export function clearRouterPackageCache(): void {
    cache.clear();
}
