/**
 * React Router 8 removed the `react-router-dom` package. The generated virtual
 * module must import from whichever package the project actually has:
 *
 *   - `react-router-dom` (v6/v7): everything from `react-router-dom`
 *   - `react-router` (v7/v8): everything from `react-router`, except
 *     `RouterProvider`, which lives in `react-router/dom`
 *
 * Two things are covered here: the detection (`resolveRouterPackage`, run
 * against fake `node_modules` trees so no real install is needed) and the
 * emitted import statements for every shape of generated module.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    REACT_ROUTER_DOM_PACKAGE,
    REACT_ROUTER_PACKAGE,
    clearRouterPackageCache,
    generateEmptyRoutesCode,
    generateRoutesCode,
    parseAppRouter,
    resolveRouterPackage,
    type RouterPackage,
} from '../src/commons/index.js';
import { cleanupAppDirs, createAppDir } from './helpers/appTree.js';

afterAll(() => {
    cleanupAppDirs();
});

// Detection against fake node_modules trees.

const projects: string[] = [];

/** A throwaway project root with the given packages "installed". */
function createProject(installed: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vparr-project-'));
    projects.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true}');
    for (const [name, version] of Object.entries(installed)) {
        const dir = path.join(root, 'node_modules', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify({ name, version, main: 'index.js' })
        );
        fs.writeFileSync(path.join(dir, 'index.js'), 'export {};\n');
    }
    return root;
}

afterAll(() => {
    for (const dir of projects) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Best effort.
        }
    }
});

/** Silences the detection warnings and returns what was warned. */
function captureWarnings(): { messages: string[]; restore: () => void } {
    const messages: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        messages.push(args.map(String).join(' '));
    };
    return { messages, restore: () => { console.warn = original; } };
}

describe('resolveRouterPackage', () => {
    let warnings: ReturnType<typeof captureWarnings>;

    beforeEach(() => {
        clearRouterPackageCache();
        warnings = captureWarnings();
    });

    afterEach(() => {
        warnings.restore();
    });

    test('react-router-dom 7 keeps the historical imports', () => {
        const root = createProject({ 'react-router-dom': '7.13.0', 'react-router': '7.13.0' });
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router-dom');
        expect(pkg.dom).toBe('react-router-dom');
        expect(pkg.major).toBe(7);
        expect(warnings.messages).toEqual([]);
    });

    test('react-router-dom 6 keeps the historical imports', () => {
        const root = createProject({ 'react-router-dom': '6.30.0', 'react-router': '6.30.0' });
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router-dom');
        expect(pkg.major).toBe(6);
    });

    test('react-router 8 alone imports from react-router and react-router/dom', () => {
        const root = createProject({ 'react-router': '8.3.1' });
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router');
        expect(pkg.dom).toBe('react-router/dom');
        expect(pkg.major).toBe(8);
        expect(warnings.messages).toEqual([]);
    });

    test('react-router 8 wins over a stale react-router-dom, with a warning', () => {
        const root = createProject({ 'react-router': '8.0.0', 'react-router-dom': '7.13.0' });
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router');
        expect(pkg.dom).toBe('react-router/dom');
        expect(warnings.messages.length).toBe(1);
        expect(warnings.messages[0]).toContain('react-router-dom');
    });

    test('react-router 7 without the shim imports from react-router', () => {
        const root = createProject({ 'react-router': '7.5.0' });
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router');
        expect(pkg.dom).toBe('react-router/dom');
        expect(pkg.major).toBe(7);
    });

    test('react-router 6 alone cannot provide the DOM APIs: warns and falls back', () => {
        const root = createProject({ 'react-router': '6.30.0' });
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router-dom');
        expect(warnings.messages.length).toBe(1);
    });

    test('nothing installed: warns and falls back to react-router-dom', () => {
        const root = createProject({});
        const pkg = resolveRouterPackage(root);
        expect(pkg.core).toBe('react-router-dom');
        expect(warnings.messages.length).toBe(1);
    });

    test('resolution walks up from a nested Vite root', () => {
        const root = createProject({ 'react-router': '8.1.0' });
        const nested = path.join(root, 'apps', 'web');
        fs.mkdirSync(nested, { recursive: true });
        expect(resolveRouterPackage(nested).core).toBe('react-router');
    });

    test('an explicit preference skips detection', () => {
        const root = createProject({ 'react-router': '8.3.1' });
        expect(resolveRouterPackage(root, 'react-router-dom')).toBe(REACT_ROUTER_DOM_PACKAGE);
        expect(resolveRouterPackage(createProject({}), 'react-router')).toBe(REACT_ROUTER_PACKAGE);
        expect(warnings.messages).toEqual([]);
    });
});

// Emitted import statements.

/** Every `import ... from '<source>'` in the generated module, by source. */
function importsBySource(code: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        const names = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
        out[m[2]!] = [...(out[m[2]!] ?? []), ...names];
    }
    return out;
}

function generateFor(appDir: string, routerPackage?: RouterPackage): string {
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
        routerPackage,
    });
}

const REGULAR_APP = ['layout.tsx', 'page.tsx', 'about/page.tsx'];
// The README's intercepting-routes example: `/feed` intercepts `/photo/:id`.
const INTERCEPT_APP = [
    'layout.tsx',
    'page.tsx',
    'feed/page.tsx',
    'feed/(..)photo/[id]/page.tsx',
    'photo/[id]/page.tsx',
];

describe('generated imports', () => {
    test('default stays on react-router-dom', () => {
        const code = generateFor(createAppDir(REGULAR_APP));
        const imports = importsBySource(code);
        expect(imports['react-router-dom']).toContain('createBrowserRouter');
        expect(imports['react-router-dom']).toContain('RouterProvider');
        expect(imports['react-router-dom']).toContain('Outlet');
        expect(imports['react-router']).toBeUndefined();
        expect(imports['react-router/dom']).toBeUndefined();
    });

    test('react-router: RouterProvider comes from react-router/dom, the rest from react-router', () => {
        const code = generateFor(createAppDir(REGULAR_APP), REACT_ROUTER_PACKAGE);
        const imports = importsBySource(code);
        expect(imports['react-router']).toContain('createBrowserRouter');
        expect(imports['react-router']).toContain('Outlet');
        expect(imports['react-router']).not.toContain('RouterProvider');
        expect(imports['react-router/dom']).toEqual(['RouterProvider']);
        expect(imports['react-router-dom']).toBeUndefined();
        expect(code).not.toContain('react-router-dom');
    });

    test('intercept mode never needs react-router/dom', () => {
        const code = generateFor(createAppDir(INTERCEPT_APP), REACT_ROUTER_PACKAGE);
        const imports = importsBySource(code);
        expect(imports['react-router']).toContain('BrowserRouter');
        expect(imports['react-router']).toContain('useRoutes');
        expect(imports['react-router/dom']).toBeUndefined();
        expect(code).not.toContain('react-router-dom');
    });

    test('intercept mode on react-router-dom is unchanged', () => {
        const code = generateFor(createAppDir(INTERCEPT_APP));
        const imports = importsBySource(code);
        expect(imports['react-router-dom']).toContain('BrowserRouter');
        expect(imports['react-router']).toBeUndefined();
    });

    test('the empty-routes fallback follows the package too', () => {
        const legacy = importsBySource(generateEmptyRoutesCode());
        expect(legacy['react-router-dom']).toEqual(['createBrowserRouter', 'RouterProvider']);

        const modern = importsBySource(generateEmptyRoutesCode({ routerPackage: REACT_ROUTER_PACKAGE }));
        expect(modern['react-router']).toEqual(['createBrowserRouter']);
        expect(modern['react-router/dom']).toEqual(['RouterProvider']);
        expect(modern['react-router-dom']).toBeUndefined();
    });

    test('runtime helpers are imported from the package, never from react-router-dom', () => {
        // The runtime (`useSlot`, `useTemplateLink`, ...) has its own router
        // import; it must resolve on v8, where `react-router-dom` is gone.
        const runtime = fs.readFileSync(path.join(import.meta.dir, '..', 'src', 'runtime.ts'), 'utf8');
        expect(runtime).not.toMatch(/from\s+['"]react-router-dom['"]/);
        expect(runtime).toMatch(/from\s+['"]react-router['"]/);
    });
});
