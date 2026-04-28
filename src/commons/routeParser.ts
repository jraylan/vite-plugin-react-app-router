/**
 * Directory structure parser for routes
 * Follows Next.js App Router conventions
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RouteNode, ParsedRoute, InterceptedRoute, ParallelSlot, SharedModuleDef, PluginOptions } from './types.js';

const DEFAULT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

const IGNORED_DIRS = new Set(['node_modules', '.git', 'components', 'lib', 'utils', 'hooks', 'styles']);

// `name` here is liberal so parametric forms work: `[+[id]]`, `(+[id])`,
// `[-[id]]`, `+[...slug]`, etc. The inner is later run through parseSegment
// to derive its URL form.
/** Matches `[+name]` (bracket invocation: adds segment derived from name). */
const SHARED_INVOKE_BRACKET_RE = /^\[\+(.+)\]$/;
/** Matches `(+name)` (paren invocation: transparent — no segment). */
const SHARED_INVOKE_PAREN_RE = /^\(\+(.+)\)$/;
/** Matches `[-name]` (bracketed omission — usable anywhere). */
const SHARED_OMIT_RE = /^\[-(.+)\]$/;
/** Matches the shorter `-name` omission form, valid only inside invocations. */
const SHARED_OMIT_BARE_RE = /^-(.+)$/;

/**
 * Returns the omission target name if `segment` is an omit marker (`[-name]`
 * or `-name`), otherwise `null`. The bare `-name` form is meant for use
 * inside an invocation site — `parseInvocationOverrides` is the only caller
 * that should accept it; the main scan still uses the bracketed form to
 * avoid colliding with regular dirs whose names happen to start with `-`.
 */
function matchOmit(segment: string, allowBare: boolean): string | null {
    const bracket = segment.match(SHARED_OMIT_RE);
    if (bracket) return bracket[1]!;
    if (allowBare) {
        const bare = segment.match(SHARED_OMIT_BARE_RE);
        if (bare) return bare[1]!;
    }
    return null;
}

/**
 * Matches Next.js intercepting-route markers at the start of a directory name:
 *   (.)foo, (..)foo, (...)foo, (..)(..)foo, (..)(..)(..)foo, ...
 *
 * The `(...)` form (root) is mutually exclusive with the dot/dotdot forms, so
 * we accept either: a single `(.)`/`(...)` or one-or-more `(..)` groups.
 */
const INTERCEPTING_MARKER_RE = /^(\(\.\.\.\)|\(\.\)|(?:\(\.\.\))+)(.+)$/;

/**
 * `'root'` for `(...)`, `'same'` for `(.)`, or the number of route levels to
 * climb for `(..)`, `(..)(..)`, `(..)(..)(..)`, ...
 */
type InterceptLevel = 'root' | 'same' | number;

/**
 * Checks if a file exists with one of the supported extensions
 */
function findFileWithExtension(
    basePath: string,
    fileName: string,
    extensions: string[]
): string | undefined {
    for (const ext of extensions) {
        const filePath = path.join(basePath, `${fileName}${ext}`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return undefined;
}

interface SegmentInfo {
    isDynamic: boolean;
    isCatchAll: boolean;
    isOptionalCatchAll: boolean;
    isGroup: boolean;
    paramName?: string;
    routeSegment: string;
    /** Set when the directory name starts with an intercepting marker */
    interceptLevel?: InterceptLevel;
}

/**
 * Parses the segment name to extract dynamic route and intercept information
 */
function parseSegment(segment: string): SegmentInfo {
    // Intercepting routes: (.), (..), (...), (..)(..), ...
    // The marker is followed by a regular segment name — recurse to parse it.
    const interceptMatch = segment.match(INTERCEPTING_MARKER_RE);
    if (interceptMatch) {
        const marker = interceptMatch[1]!;
        const rest = interceptMatch[2]!;
        let level: InterceptLevel;
        if (marker === '(.)') {
            level = 'same';
        } else if (marker === '(...)') {
            level = 'root';
        } else {
            // One or more "(..)" groups concatenated — the count is the climb.
            level = (marker.match(/\(\.\.\)/g) || []).length;
        }
        return { ...parseSegment(rest), interceptLevel: level };
    }

    // Route group: (folder)
    if (segment.startsWith('(') && segment.endsWith(')')) {
        return {
            isDynamic: false,
            isCatchAll: false,
            isOptionalCatchAll: false,
            isGroup: true,
            routeSegment: '',
        };
    }

    // Optional catch-all: [[...param]]
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        const paramName = segment.slice(5, -2);
        return {
            isDynamic: true,
            isCatchAll: false,
            isOptionalCatchAll: true,
            isGroup: false,
            paramName,
            routeSegment: `*`,
        };
    }

    // Catch-all: [...param]
    if (segment.startsWith('[...') && segment.endsWith(']')) {
        const paramName = segment.slice(4, -1);
        return {
            isDynamic: true,
            isCatchAll: true,
            isOptionalCatchAll: false,
            isGroup: false,
            paramName,
            routeSegment: `*`,
        };
    }

    // Dynamic: [param]
    if (segment.startsWith('[') && segment.endsWith(']')) {
        const paramName = segment.slice(1, -1);
        return {
            isDynamic: true,
            isCatchAll: false,
            isOptionalCatchAll: false,
            isGroup: false,
            paramName,
            routeSegment: `:${paramName}`,
        };
    }

    // Static segment
    return {
        isDynamic: false,
        isCatchAll: false,
        isOptionalCatchAll: false,
        isGroup: false,
        routeSegment: segment,
    };
}

/**
 * Resolves an intercepting marker to the URL prefix it points at, given the
 * route ancestors leading to the marker's parent (excluding route groups).
 *
 *   `(.)`        — same level as the marker's parent
 *   `(..)`       — one route level above
 *   `(..)(..)`   — two route levels above
 *   `(...)`      — the app root
 */
function resolveInterceptBase(
    routeAncestors: string[],
    level: InterceptLevel
): string[] {
    if (level === 'root') return [];
    if (level === 'same') return [...routeAncestors];
    const climb = Math.min(level, routeAncestors.length);
    return routeAncestors.slice(0, routeAncestors.length - climb);
}

/**
 * Joins URL segments into an absolute pathname (always starts with `/`).
 */
function joinUrlSegments(segments: string[]): string {
    if (segments.length === 0) return '/';
    return '/' + segments.join('/');
}

interface ScanContext {
    /** Route segments (URL-form) leading to the current directory, excluding route groups */
    routeAncestors: string[];
    /** When inside an intercepting subtree, the source URL where interception originates */
    interceptSource?: string;
    /** Pre-discovered shared modules used to resolve `[+name]`/`(+name)` invocations. */
    sharedRegistry?: SharedModuleDef[];
}

/**
 * Top-level discovery of `+name/` shared modules. Walks `rootDir` and stops
 * descending whenever a `+name/` is found — its sub-shareds are stored as
 * placeholders inside its tree (see parseSharedModuleDef), not promoted to
 * top level.
 */
export function discoverSharedModules(
    rootDir: string,
    extensions: string[] = DEFAULT_EXTENSIONS
): SharedModuleDef[] {
    const result: SharedModuleDef[] = [];
    walk(rootDir);
    return result;

    function walk(dir: string): void {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            if (e.name.startsWith('_') || IGNORED_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.name.startsWith('+')) {
                const parsed = parseSharedDefName(e.name);
                result.push(parseSharedModuleDef(parsed, full, dir, extensions));
                continue; // sub-shareds are nested inside, not top-level
            }
            walk(full);
        }
    }
}

/**
 * Strips the leading `+` from a shared-module dir name and, if present, an
 * intercept marker prefix (`(.)`, `(..)`, `(...)`, `(..)(..)`, ...). Returns
 * the bare template name plus the climb level (when the template was declared
 * as intercept-flavored).
 */
function parseSharedDefName(rawDirName: string): { name: string; level?: 'same' | 'root' | number } {
    const inner = rawDirName.slice(1); // drop leading '+'
    const m = inner.match(INTERCEPTING_MARKER_RE);
    if (m) {
        const marker = m[1]!;
        const name = m[2]!;
        let level: 'same' | 'root' | number;
        if (marker === '(.)') level = 'same';
        else if (marker === '(...)') level = 'root';
        else level = (marker.match(/\(\.\.\)/g) || []).length;
        return { name, level };
    }
    return { name: inner };
}

function parseSharedModuleDef(
    parsed: { name: string; level?: 'same' | 'root' | number },
    dirPath: string,
    containerDir: string,
    extensions: string[]
): SharedModuleDef {
    return {
        name: parsed.name,
        dirPath,
        containerDir,
        ...(parsed.level !== undefined ? { interceptLevel: parsed.level } : {}),
        layoutPath: findFileWithExtension(dirPath, 'layout', extensions),
        pagePath: findFileWithExtension(dirPath, 'page', extensions),
        loadingPath: findFileWithExtension(dirPath, 'loading', extensions),
        errorPath: findFileWithExtension(dirPath, 'error', extensions),
        notFoundPath: findFileWithExtension(dirPath, 'not-found', extensions),
        tree: parseSharedTreeRecursive(dirPath, extensions, ''),
        subShareds: {},
    };
}

/**
 * Parses the children of a `+name/` directory. Nested `+sub/` directories
 * become placeholder RouteNodes carrying the full SharedModuleDef so they can
 * be expanded at graft time.
 */
function parseSharedTreeRecursive(
    dirPath: string,
    extensions: string[],
    parentPath: string
): RouteNode[] {
    if (!fs.existsSync(dirPath)) return [];
    const nodes: RouteNode[] = [];
    for (const e of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('_') || IGNORED_DIRS.has(e.name)) continue;
        const full = path.join(dirPath, e.name);

        if (e.name.startsWith('+')) {
            const parsed = parseSharedDefName(e.name);
            const subName = parsed.name;
            const subDef = parseSharedModuleDef(parsed, full, dirPath, extensions);
            // Placeholder carries its position in the shared subtree as a
            // relative URL path, so graft-time can prefix the invoker urlBase
            // and arrive at the right absolute URL for the sub-shared. Run
            // the inner name through parseSegment so parametric sub-shareds
            // (`+[id]`, `+[...slug]`) become `:id` / `*` in the URL.
            const subSegInfo = parseSegment(subName);
            const subUrlSeg = subSegInfo.routeSegment;
            const placeholderPath = (
                parentPath + (subUrlSeg ? '/' + subUrlSeg : '')
            ).replace(/\/+/g, '/');
            nodes.push({
                segment: e.name,
                path: placeholderPath,
                isDynamic: subSegInfo.isDynamic,
                isCatchAll: subSegInfo.isCatchAll,
                isOptionalCatchAll: subSegInfo.isOptionalCatchAll,
                isGroup: false,
                ...(subSegInfo.paramName ? { paramName: subSegInfo.paramName } : {}),
                children: [],
                isSharedDef: true,
                sharedDef: subDef,
            });
            continue;
        }

        const seg = parseSegment(e.name);
        const routePath = seg.isGroup
            ? parentPath
            : parentPath + (seg.routeSegment ? `/${seg.routeSegment}` : '');

        nodes.push({
            segment: e.name,
            path: routePath || '/',
            isDynamic: seg.isDynamic,
            isCatchAll: seg.isCatchAll,
            isOptionalCatchAll: seg.isOptionalCatchAll,
            isGroup: seg.isGroup,
            paramName: seg.paramName,
            pagePath: findFileWithExtension(full, 'page', extensions),
            layoutPath: findFileWithExtension(full, 'layout', extensions),
            loadingPath: findFileWithExtension(full, 'loading', extensions),
            errorPath: findFileWithExtension(full, 'error', extensions),
            notFoundPath: findFileWithExtension(full, 'not-found', extensions),
            children: parseSharedTreeRecursive(full, extensions, routePath),
        });
    }
    return nodes;
}

interface InvocationOverrideFiles {
    pagePath?: string;
    layoutPath?: string;
    loadingPath?: string;
    errorPath?: string;
    notFoundPath?: string;
    /** `props.tsx` (or .ts/.jsx/.js) — values forwarded to the shared subtree via useSharedProps(). */
    propsPath?: string;
}

interface InvocationOverride extends InvocationOverrideFiles {
    type: 'omit' | 'drill';
    /** For `omit`: sub-shared name. For `drill`: directory segment to mirror. */
    name: string;
    children?: InvocationOverride[];
}

interface InvocationOverrideRoot extends InvocationOverrideFiles {
    children: InvocationOverride[];
}

/**
 * Walks the children of a `[+name]/` or `(+name)/` invocation directory,
 * collecting `[-omit]/` markers, drill-down dirs that mirror the shared
 * module's structure, and any file overrides (page/layout/loading/error/
 * not-found) that should replace the shared module's files at the same
 * position.
 */
function parseInvocationOverrideRoot(
    dirPath: string,
    extensions: string[]
): InvocationOverrideRoot {
    return {
        ...readOverrideFiles(dirPath, extensions),
        children: parseInvocationOverrides(dirPath, extensions),
    };
}

function parseInvocationOverrides(
    dirPath: string,
    extensions: string[]
): InvocationOverride[] {
    if (!fs.existsSync(dirPath)) return [];
    const out: InvocationOverride[] = [];
    for (const e of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('_') || IGNORED_DIRS.has(e.name)) continue;
        // Inside an invocation we accept the shorter `-name/` form alongside
        // `[-name]/` — both express the same intent and the bracketed form is
        // visually noisy for parametric names like `[-[id]]` vs `-[id]`.
        const omitName = matchOmit(e.name, true);
        if (omitName) {
            out.push({ type: 'omit', name: omitName });
            continue;
        }
        const full = path.join(dirPath, e.name);
        out.push({
            type: 'drill',
            name: e.name,
            ...readOverrideFiles(full, extensions),
            children: parseInvocationOverrides(full, extensions),
        });
    }
    return out;
}

function readOverrideFiles(dirPath: string, extensions: string[]): InvocationOverrideFiles {
    const files: InvocationOverrideFiles = {};
    const p = findFileWithExtension(dirPath, 'page', extensions);
    const l = findFileWithExtension(dirPath, 'layout', extensions);
    const ld = findFileWithExtension(dirPath, 'loading', extensions);
    const er = findFileWithExtension(dirPath, 'error', extensions);
    const nf = findFileWithExtension(dirPath, 'not-found', extensions);
    const pr = findFileWithExtension(dirPath, 'props', extensions);
    if (p) files.pagePath = p;
    if (l) files.layoutPath = l;
    if (ld) files.loadingPath = ld;
    if (er) files.errorPath = er;
    if (nf) files.notFoundPath = nf;
    if (pr) files.propsPath = pr;
    return files;
}

function isUnder(child: string, ancestor: string): boolean {
    if (child === ancestor) return false;
    const rel = path.relative(ancestor, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolves `[+name]`/`(+name)` from the invocation directory by visibility.
 * Visibility = invocation must be a descendant of the GRANDPARENT of the
 * `+name/` directory, but *not* under the directory that contains it. Closest
 * (deepest grandparent) wins.
 */
function findVisibleShared(
    modules: SharedModuleDef[] | undefined,
    name: string,
    invocationDir: string
): SharedModuleDef | undefined {
    if (!modules) return undefined;
    let best: SharedModuleDef | undefined;
    let bestDepth = -1;
    for (const m of modules) {
        if (m.name !== name) continue;
        const visRoot = path.dirname(m.containerDir);
        if (!isUnder(invocationDir, visRoot)) continue;
        if (invocationDir === m.containerDir || isUnder(invocationDir, m.containerDir)) continue;
        const depth = visRoot.split(path.sep).length;
        if (depth > bestDepth) {
            best = m;
            bestDepth = depth;
        }
    }
    return best;
}

/**
 * Walks the shared tree, applying invoker overrides and computing absolute
 * URLs by prefixing the relative paths stored in the shared subtree.
 *
 * Sub-shared placeholders are expanded recursively, prefixing the URL with
 * the sub-shared's name (bracket-style by default). `[-name]/` overrides at
 * the matching depth omit the corresponding sub-shared. `activeAcc` collects
 * the names of sub-shareds that ended up active at the current invocation
 * (used by codegen to feed the runtime SharedModuleProvider).
 */
function pickOverride<K extends keyof InvocationOverrideFiles>(
    override: InvocationOverrideFiles | undefined,
    base: string | undefined,
    key: K
): string | undefined {
    return override?.[key] ?? base;
}

function graftSubtree(
    sharedNodes: RouteNode[],
    overrides: InvocationOverride[],
    urlBase: string,
    activeAcc: string[]
): RouteNode[] {
    // `omitted`           — drops both canonical AND intercept variants for the
    //                       given name (`[-id]/` or `-id/`).
    // `omittedInterceptOnly` — drops only the intercept variant, leaving the
    //                       canonical mount alone (`[-(.)id]/`, `[-(..)id]/`,
    //                       `[-(...)id]/`, etc.). Useful when a mount opts out
    //                       of the drawer overlay but still wants the regular
    //                       full-screen detail page.
    const omitted = new Set<string>();
    const omittedInterceptOnly = new Set<string>();
    const drills = new Map<string, InvocationOverride>();
    for (const ov of overrides) {
        if (ov.type === 'omit') {
            const im = ov.name.match(INTERCEPTING_MARKER_RE);
            if (im) omittedInterceptOnly.add(im[2]!);
            else omitted.add(ov.name);
        } else {
            drills.set(ov.name, ov);
        }
    }

    // Pair canonical (non-intercept) with intercept variants of the same name.
    // Intercept-flavored sub-shareds borrow the canonical sibling's tree as
    // their children template, so URLs like `/clientes/:id/info` keep the
    // overlay alive even though the intercept template (`+(.)[id]/`) only
    // declares its own layout + page.
    const canonicalSiblingByName = new Map<string, SharedModuleDef>();
    for (const sn of sharedNodes) {
        if (
            sn.isSharedDef &&
            sn.sharedDef &&
            sn.sharedDef.interceptLevel === undefined
        ) {
            canonicalSiblingByName.set(sn.sharedDef.name, sn.sharedDef);
        }
    }

    const result: RouteNode[] = [];
    for (const sn of sharedNodes) {
        if (sn.isSharedDef && sn.sharedDef) {
            const sub = sn.sharedDef;
            const isIntercept = sub.interceptLevel !== undefined;
            if (omitted.has(sub.name)) continue;
            if (isIntercept && omittedInterceptOnly.has(sub.name)) continue;
            // Track active sub-shareds for the parent invocation's
            // SharedModuleProvider. Push only on the canonical variant when
            // a canonical sibling exists (to avoid double-counting the same
            // name); otherwise push the intercept name so a standalone
            // intercept template still surfaces via useSharedSlot().
            const hasCanonicalSibling = isIntercept && canonicalSiblingByName.has(sub.name);
            if (!isIntercept || !hasCanonicalSibling) activeAcc.push(sub.name);
            const subDrill = drills.get('+' + sub.name) || drills.get(sub.name);
            const subOv = subDrill?.children ?? [];

            // If the sub-shared was declared with an intercept marker
            // (`+(.)[id]/`, `+(..)foo/`, ...), compute its target URL by
            // climbing the invoker's URL ancestors instead of just appending
            // the sub-shared's segment. The grafted subtree is then marked as
            // intercepting with sourcePath=urlBase so it surfaces through the
            // intercepts collector (BG outlet stays mounted at the parent
            // shared's invocation URL).
            let subBase: string;
            if (isIntercept) {
                const ancestors = urlBase
                    .replace(/^\//, '')
                    .split('/')
                    .filter(Boolean);
                const climbed = resolveInterceptBase(ancestors, sub.interceptLevel!);
                const subSeg = parseSegment(sub.name).routeSegment;
                const targetAncestors = subSeg ? [...climbed, subSeg] : climbed;
                subBase = joinUrlSegments(targetAncestors);
            } else {
                // Placeholder.path = parent-relative URL inside the shared
                // (e.g. `/:id/historico`). Prefixing with the invoker urlBase
                // yields the absolute URL where the sub-shared materializes.
                subBase = (urlBase + sn.path).replace(/\/+/g, '/');
            }

            // Children template: for intercept variants paired with a
            // canonical sibling, use the canonical's tree so sub-shareds
            // (`+info/`, `+atendimentos/`, ...) appear under the overlay's
            // root layout. Files (layout/page/loading/error/not-found) are
            // taken from the intercept template only — the canonical layout
            // is intentionally dropped so the overlay's drawer shell isn't
            // wrapped around another full-screen layout.
            const childrenTemplate = isIntercept
                ? (canonicalSiblingByName.get(sub.name)?.tree ?? sub.tree)
                : sub.tree;
            const subActive: string[] = [];
            const subChildren = graftSubtree(childrenTemplate, subOv, subBase, subActive);
            const subPage = pickOverride(subDrill, sub.pagePath, 'pagePath');
            const subLayout = pickOverride(subDrill, sub.layoutPath, 'layoutPath');
            const subLoading = pickOverride(subDrill, sub.loadingPath, 'loadingPath');
            const subError = pickOverride(subDrill, sub.errorPath, 'errorPath');
            const subNotFound = pickOverride(subDrill, sub.notFoundPath, 'notFoundPath');
            const subProps = subDrill?.propsPath;
            const subNode: RouteNode = {
                segment: '+' + sub.name,
                path: subBase || '/',
                isDynamic: sn.isDynamic,
                isCatchAll: sn.isCatchAll,
                isOptionalCatchAll: sn.isOptionalCatchAll,
                isGroup: false,
                ...(sn.paramName ? { paramName: sn.paramName } : {}),
                ...(subLayout ? { layoutPath: subLayout } : {}),
                ...(subPage ? { pagePath: subPage } : {}),
                ...(subLoading ? { loadingPath: subLoading } : {}),
                ...(subError ? { errorPath: subError } : {}),
                ...(subNotFound ? { notFoundPath: subNotFound } : {}),
                ...(subProps ? { sharedPropsPath: subProps } : {}),
                children: subChildren,
                sharedInvocation: { name: sub.name, activeSubShareds: subActive },
            };
            if (isIntercept) {
                // Source = the URL where the parent shared is mounted (the
                // list page from the user's perspective). markInterceptingSubtree
                // recurses through the grafted children too.
                markInterceptingSubtree(subNode, urlBase || '/');
            }
            result.push(subNode);
            continue;
        }

        const newPath = (urlBase + sn.path).replace(/\/+/g, '/') || '/';
        const drill = drills.get(sn.segment);
        const childOv = drill?.children ?? [];
        const grafted = graftSubtree(sn.children, childOv, urlBase, activeAcc);
        // File overrides drilled into the invoker site replace the shared's
        // files at the matching position. Helps customise individual leaves
        // without forking the shared module.
        const ovPage = pickOverride(drill, sn.pagePath, 'pagePath');
        const ovLayout = pickOverride(drill, sn.layoutPath, 'layoutPath');
        const ovLoading = pickOverride(drill, sn.loadingPath, 'loadingPath');
        const ovError = pickOverride(drill, sn.errorPath, 'errorPath');
        const ovNotFound = pickOverride(drill, sn.notFoundPath, 'notFoundPath');
        const ovProps = drill?.propsPath;
        result.push({
            ...sn,
            path: newPath,
            ...(ovPage ? { pagePath: ovPage } : { pagePath: undefined }),
            ...(ovLayout ? { layoutPath: ovLayout } : { layoutPath: undefined }),
            ...(ovLoading ? { loadingPath: ovLoading } : { loadingPath: undefined }),
            ...(ovError ? { errorPath: ovError } : { errorPath: undefined }),
            ...(ovNotFound ? { notFoundPath: ovNotFound } : { notFoundPath: undefined }),
            ...(ovProps ? { sharedPropsPath: ovProps } : {}),
            children: grafted,
        });
    }
    return result;
}

/**
 * Materializes a shared module at a single invocation site, returning the
 * top-level RouteNode that wraps the grafted subtree.
 *
 * `rootOverrides` carries top-level file overrides declared at the invocation
 * directory itself (e.g. `[+clientes]/page.tsx` overriding `+clientes/page.tsx`).
 */
/**
 * Recursively flips a grafted subtree into intercept mode by stamping every
 * node with `isIntercepting` + `interceptSource`. flattenRoutes then routes
 * each page node through collectIntercepts instead of the regular routes
 * table — letting a shared route module be mounted as an interception.
 */
function markInterceptingSubtree(node: RouteNode, sourcePath: string): void {
    node.isIntercepting = true;
    node.interceptSource = sourcePath;
    for (const c of node.children) markInterceptingSubtree(c, sourcePath);
}

function graftSharedModule(
    shared: SharedModuleDef,
    urlBase: string,
    rootOverrides: InvocationOverrideRoot
): RouteNode {
    const active: string[] = [];
    const children = graftSubtree(shared.tree, rootOverrides.children, urlBase, active);
    const page = rootOverrides.pagePath ?? shared.pagePath;
    const layout = rootOverrides.layoutPath ?? shared.layoutPath;
    const loading = rootOverrides.loadingPath ?? shared.loadingPath;
    const error = rootOverrides.errorPath ?? shared.errorPath;
    const notFound = rootOverrides.notFoundPath ?? shared.notFoundPath;
    const props = rootOverrides.propsPath;
    return {
        segment: '+' + shared.name,
        path: urlBase || '/',
        isDynamic: false,
        isCatchAll: false,
        isOptionalCatchAll: false,
        isGroup: false,
        ...(layout ? { layoutPath: layout } : {}),
        ...(page ? { pagePath: page } : {}),
        ...(loading ? { loadingPath: loading } : {}),
        ...(error ? { errorPath: error } : {}),
        ...(notFound ? { notFoundPath: notFound } : {}),
        ...(props ? { sharedPropsPath: props } : {}),
        children,
        sharedInvocation: { name: shared.name, activeSubShareds: active },
    };
}

/**
 * Recursively scans the app directory and builds both the route tree and any
 * parallel-route slots (`@name/`) declared at this level. Slots are attached
 * to the node of the directory they belong to (i.e. siblings of `layout.tsx`).
 */
export function scanAppDirectoryWithSlots(
    dirPath: string,
    extensions: string[] = DEFAULT_EXTENSIONS,
    parentPath: string = '',
    ctx: ScanContext = { routeAncestors: [] }
): { nodes: RouteNode[]; slots: ParallelSlot[] } {
    if (!fs.existsSync(dirPath)) {
        return { nodes: [], slots: [] };
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const nodes: RouteNode[] = [];
    const slots: ParallelSlot[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Ignore directories starting with _ (private folders)
        if (entry.name.startsWith('_')) continue;

        // Ignore common directories that are not routes
        if (IGNORED_DIRS.has(entry.name)) {
            continue;
        }

        const fullDirPath = path.join(dirPath, entry.name);

        // `+name/` — shared route module DEFINITION. Discovered separately;
        // does not contribute to the regular route tree.
        if (entry.name.startsWith('+')) {
            continue;
        }

        // `[-name]/` — omission marker only meaningful inside a `[+name]`/
        // `(+name)` invocation site (where parseInvocationOverrides handles
        // it). Stray markers are silently dropped.
        if (SHARED_OMIT_RE.test(entry.name)) {
            continue;
        }

        // `[+name]/` / `(+name)/` invocations — possibly prefixed with an
        // intercept marker (`(.)`/`(..)`/`(...)`/etc.) so a shared module can
        // be mounted as an interception, e.g. `feed/(..)[+photoModal]/`
        // intercepts the URL produced by `+photoModal` from the `/feed` source.
        const interceptPrefixMatch = entry.name.match(INTERCEPTING_MARKER_RE);
        const invocationCandidate = interceptPrefixMatch ? interceptPrefixMatch[2]! : entry.name;
        const bracketMatch = invocationCandidate.match(SHARED_INVOKE_BRACKET_RE);
        const parenMatch = invocationCandidate.match(SHARED_INVOKE_PAREN_RE);
        if (bracketMatch || parenMatch) {
            const invokeName = (bracketMatch || parenMatch)![1]!;
            const style: 'bracket' | 'paren' = bracketMatch ? 'bracket' : 'paren';

            // Resolve the intercept marker (if any) into a climb level so we
            // can compute the target URL the same way ordinary intercepting
            // routes do.
            let interceptLevel: InterceptLevel | undefined;
            if (interceptPrefixMatch) {
                const m = interceptPrefixMatch[1]!;
                if (m === '(.)') interceptLevel = 'same';
                else if (m === '(...)') interceptLevel = 'root';
                else interceptLevel = (m.match(/\(\.\.\)/g) || []).length;
            }

            const shared = findVisibleShared(ctx.sharedRegistry, invokeName, fullDirPath);
            if (!shared) {
                console.warn(
                    `[vite-plugin-react-app-router] cannot resolve shared module ` +
                    `"${invokeName}" at ${fullDirPath} — no visible \`+${invokeName}/\` ` +
                    `definition found among sibling sub-directories.`
                );
                continue;
            }
            // Template-side fallback: when the consumer did not prefix the
            // invocation but the template itself was declared as intercept-
            // flavored (`+(.)foo/`, `+(..)foo/`, ...), inherit the template's
            // climb level so the consumer can keep its short syntax.
            if (interceptLevel === undefined && shared.interceptLevel !== undefined) {
                interceptLevel = shared.interceptLevel;
            }
            const isInterceptInvocation = interceptLevel !== undefined;
            // Paren-style invocations are transparent (no URL segment), so the
            // shared module's own page would render at the same URL as the
            // invoker's parent page — a routing conflict in react-router.
            // Detect and warn so the user can pick a side. (Skipped for
            // intercepting paren invocations since the source page lives at
            // a different URL than the target.)
            if (style === 'paren' && !isInterceptInvocation) {
                const parentPagePath = findFileWithExtension(dirPath, 'page', extensions);
                const sharedTopPagePath =
                    findFileWithExtension(fullDirPath, 'page', extensions) ?? shared.pagePath;
                if (parentPagePath && sharedTopPagePath) {
                    console.warn(
                        `[vite-plugin-react-app-router] (+${invokeName}) at ${fullDirPath} ` +
                        `overlaps a sibling page.tsx at ${parentPagePath}. ` +
                        `Paren invocations must not have a sibling page when the shared ` +
                        `module also defines a page — remove one to resolve the conflict.`
                    );
                }
            }
            const overridesRoot = parseInvocationOverrideRoot(fullDirPath, extensions);
            // Parametric invocations (`[+[id]]/`) produce dynamic URL segments
            // by running the inner name through parseSegment. Static names map
            // to themselves; `[id]` → `:id`; `[...slug]` → `*`.
            const invokeSegInfo = parseSegment(invokeName);
            const invokeUrlSeg = invokeSegInfo.routeSegment;

            let urlBase: string;
            if (isInterceptInvocation) {
                // Climb the route ancestors per the marker, then append the
                // invocation's own segment when bracket-style.
                const climbed = resolveInterceptBase(ctx.routeAncestors, interceptLevel!);
                const targetAncestors = style === 'bracket' && invokeUrlSeg
                    ? [...climbed, invokeUrlSeg]
                    : climbed;
                urlBase = joinUrlSegments(targetAncestors);
            } else {
                urlBase = style === 'bracket'
                    ? ((parentPath || '') + (invokeUrlSeg ? '/' + invokeUrlSeg : ''))
                        .replace(/\/+/g, '/')
                    : (parentPath || '/');
            }
            const grafted = graftSharedModule(shared, urlBase, overridesRoot);
            // Reflect the parsed segment kind on the grafted node so the
            // parent's sort places parametric invocations after static ones.
            if (style === 'bracket' && !isInterceptInvocation) {
                grafted.isDynamic = invokeSegInfo.isDynamic;
                grafted.isCatchAll = invokeSegInfo.isCatchAll;
                grafted.isOptionalCatchAll = invokeSegInfo.isOptionalCatchAll;
                if (invokeSegInfo.paramName) grafted.paramName = invokeSegInfo.paramName;
            }
            if (isInterceptInvocation) {
                // Mark the whole grafted subtree as intercepting so flatten
                // routes them through the intercepts collector instead of
                // mounting them as canonical pages.
                const sourcePath = parentPath || '/';
                markInterceptingSubtree(grafted, sourcePath);
            }
            nodes.push(grafted);
            continue;
        }

        // Parallel route slot: @name/ — siblings of layout.tsx, owned by the
        // current directory's segment. The slot is matched independently
        // against the URL, so its tree starts from the same parentPath.
        if (entry.name.startsWith('@')) {
            const slotName = entry.name.slice(1);
            const slotResult = scanAppDirectoryWithSlots(
                fullDirPath,
                extensions,
                parentPath,
                { ...ctx }
            );
            slots.push({
                name: slotName,
                tree: slotResult.nodes,
                pagePath: findFileWithExtension(fullDirPath, 'page', extensions),
                layoutPath: findFileWithExtension(fullDirPath, 'layout', extensions),
                loadingPath: findFileWithExtension(fullDirPath, 'loading', extensions),
                errorPath: findFileWithExtension(fullDirPath, 'error', extensions),
                notFoundPath: findFileWithExtension(fullDirPath, 'not-found', extensions),
                defaultPath: findFileWithExtension(fullDirPath, 'default', extensions),
            });
            continue;
        }

        const segmentInfo = parseSegment(entry.name);

        // Entering a new intercepting subtree (only at the top of an intercept chain)
        if (segmentInfo.interceptLevel !== undefined && !ctx.interceptSource) {
            const sourcePath = parentPath || '/';
            const climbed = resolveInterceptBase(ctx.routeAncestors, segmentInfo.interceptLevel);
            const targetAncestors = segmentInfo.routeSegment
                ? [...climbed, segmentInfo.routeSegment]
                : climbed;
            const targetPath = joinUrlSegments(targetAncestors);

            const childCtx: ScanContext = {
                routeAncestors: targetAncestors,
                interceptSource: sourcePath,
                sharedRegistry: ctx.sharedRegistry,
            };

            const childResult = scanAppDirectoryWithSlots(fullDirPath, extensions, targetPath, childCtx);

            const node: RouteNode = {
                segment: entry.name,
                path: targetPath,
                isDynamic: segmentInfo.isDynamic,
                isCatchAll: segmentInfo.isCatchAll,
                isOptionalCatchAll: segmentInfo.isOptionalCatchAll,
                isGroup: false,
                paramName: segmentInfo.paramName,
                isIntercepting: true,
                interceptSource: sourcePath,
                pagePath: findFileWithExtension(fullDirPath, 'page', extensions),
                loadingPath: findFileWithExtension(fullDirPath, 'loading', extensions),
                errorPath: findFileWithExtension(fullDirPath, 'error', extensions),
                children: childResult.nodes,
                ...(childResult.slots.length > 0 ? { slots: childResult.slots } : {}),
            };

            nodes.push(node);
            continue;
        }

        // Calculate the route path
        const routePath = segmentInfo.isGroup
            ? parentPath
            : parentPath + (segmentInfo.routeSegment ? `/${segmentInfo.routeSegment}` : '');

        const childAncestors = segmentInfo.isGroup
            ? ctx.routeAncestors
            : segmentInfo.routeSegment
                ? [...ctx.routeAncestors, segmentInfo.routeSegment]
                : ctx.routeAncestors;

        const childResult = scanAppDirectoryWithSlots(fullDirPath, extensions, routePath, {
            routeAncestors: childAncestors,
            interceptSource: ctx.interceptSource,
            sharedRegistry: ctx.sharedRegistry,
        });

        const node: RouteNode = {
            segment: entry.name,
            path: routePath || '/',
            isDynamic: segmentInfo.isDynamic,
            isCatchAll: segmentInfo.isCatchAll,
            isOptionalCatchAll: segmentInfo.isOptionalCatchAll,
            isGroup: segmentInfo.isGroup,
            paramName: segmentInfo.paramName,
            isIntercepting: ctx.interceptSource !== undefined,
            interceptSource: ctx.interceptSource,
            pagePath: findFileWithExtension(fullDirPath, 'page', extensions),
            layoutPath: findFileWithExtension(fullDirPath, 'layout', extensions),
            loadingPath: findFileWithExtension(fullDirPath, 'loading', extensions),
            errorPath: findFileWithExtension(fullDirPath, 'error', extensions),
            notFoundPath: findFileWithExtension(fullDirPath, 'not-found', extensions),
            children: childResult.nodes,
            ...(childResult.slots.length > 0 ? { slots: childResult.slots } : {}),
        };

        nodes.push(node);
    }

    // Sort: static routes first, dynamic routes second, catch-all last
    nodes.sort((a, b) => {
        if (a.isCatchAll || a.isOptionalCatchAll) return 1;
        if (b.isCatchAll || b.isOptionalCatchAll) return -1;
        if (a.isDynamic && !b.isDynamic) return 1;
        if (!a.isDynamic && b.isDynamic) return -1;
        return a.segment.localeCompare(b.segment);
    });
    return { nodes, slots };
}

/**
 * Backward-compatible wrapper: returns just the route nodes (without the
 * top-level slot list, which lives on the app root).
 */
export function scanAppDirectory(
    dirPath: string,
    extensions: string[] = DEFAULT_EXTENSIONS,
    parentPath: string = '',
    ctx: ScanContext = { routeAncestors: [] }
): RouteNode[] {
    return scanAppDirectoryWithSlots(dirPath, extensions, parentPath, ctx).nodes;
}

/**
 * Checks if there's a page.tsx in the app root
 */
export function getRootPage(
    appDir: string,
    extensions: string[] = DEFAULT_EXTENSIONS
): { pagePath?: string; layoutPath?: string; loadingPath?: string; errorPath?: string; notFoundPath?: string } {
    return {
        pagePath: findFileWithExtension(appDir, 'page', extensions),
        layoutPath: findFileWithExtension(appDir, 'layout', extensions),
        loadingPath: findFileWithExtension(appDir, 'loading', extensions),
        errorPath: findFileWithExtension(appDir, 'error', extensions),
        notFoundPath: findFileWithExtension(appDir, 'not-found', extensions),
    };
}

interface ParentContext {
    layouts: string[];
    loadingPath?: string;
    errorPath?: string;
    notFoundPath?: string;
    /** Map of layout path to its specific not-found component */
    layoutNotFoundMap: Map<string, string>;
}

export interface FlattenedRoutes {
    routes: ParsedRoute[];
    intercepts: InterceptedRoute[];
}

/**
 * Flattens the route tree into a list of parsed routes plus intercepts.
 * Intercepting subtrees are extracted into a separate list so that the
 * regular route table doesn't contain duplicates at the same URL.
 */
export function flattenRoutes(
    nodes: RouteNode[],
    parentContext: ParentContext = { layouts: [], layoutNotFoundMap: new Map() },
    rootContext?: { layoutPath?: string; loadingPath?: string; errorPath?: string; notFoundPath?: string }
): FlattenedRoutes {
    const routes: ParsedRoute[] = [];
    const intercepts: InterceptedRoute[] = [];

    // Merge root context with parent context
    const context: ParentContext = rootContext
        ? {
            layouts: rootContext.layoutPath ? [rootContext.layoutPath, ...parentContext.layouts] : parentContext.layouts,
            loadingPath: rootContext.loadingPath || parentContext.loadingPath,
            errorPath: rootContext.errorPath || parentContext.errorPath,
            notFoundPath: rootContext.notFoundPath || parentContext.notFoundPath,
            layoutNotFoundMap: new Map(parentContext.layoutNotFoundMap),
        }
        : parentContext;

    // If root has a layout and not-found, add to map
    if (rootContext?.layoutPath && rootContext?.notFoundPath) {
        context.layoutNotFoundMap.set(rootContext.layoutPath, rootContext.notFoundPath);
    }

    for (const node of nodes) {
        // Intercepting subtree: emit a single intercept entry whose subtree is
        // the entire grafted RouteNode. The codegen treats each entry as a
        // self-contained route table (its own layout/page + sub-shared
        // children with absolute URLs) so a tab-style overlay keeps the
        // drawer mounted while sub-routes change.
        if (node.isIntercepting && node.interceptSource !== undefined) {
            intercepts.push({
                sourcePattern: node.interceptSource,
                targetPattern: node.path || '/',
                subtree: node,
            });
            continue;
        }

        // Build current context - child values override parent values
        const currentLayoutNotFoundMap = new Map(context.layoutNotFoundMap);

        // If this node has a layout and a not-found, add to map
        if (node.layoutPath && node.notFoundPath) {
            currentLayoutNotFoundMap.set(node.layoutPath, node.notFoundPath);
        }

        const currentContext: ParentContext = {
            layouts: node.layoutPath ? [...context.layouts, node.layoutPath] : context.layouts,
            loadingPath: node.loadingPath || context.loadingPath,
            errorPath: node.errorPath || context.errorPath,
            notFoundPath: node.notFoundPath || context.notFoundPath,
            layoutNotFoundMap: currentLayoutNotFoundMap,
        };

        // If the node has a page, add the route
        if (node.pagePath) {
            routes.push({
                pattern: node.path || '/',
                pagePath: node.pagePath,
                layouts: currentContext.layouts,
                loadingPath: currentContext.loadingPath,
                errorPath: currentContext.errorPath,
                notFoundPath: currentContext.notFoundPath,
                layoutNotFoundMap: new Map(currentContext.layoutNotFoundMap),
            });
        }

        // Process children recursively
        if (node.children.length > 0) {
            const childResult = flattenRoutes(node.children, currentContext);
            routes.push(...childResult.routes);
            intercepts.push(...childResult.intercepts);
        }
    }

    return { routes, intercepts };
}

/**
 * Converts the absolute path to a relative import path
 */
export function toImportPath(filePath: string, rootDir: string): string {
    const relativePath = path.relative(rootDir, filePath);
    // Normalize to forward slashes and remove extension
    const normalized = relativePath.replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '');
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

/**
 * Generates a valid JavaScript identifier from a path
 */
export function pathToIdentifier(routePath: string): string {
    if (routePath === '/' || routePath === '') {
        return 'Root';
    }
    return routePath
        .replace(/^\//, '')
        .replace(/[/:*[\]]/g, '_')
        .replace(/_+/g, '_')
        .replace(/_$/, '')
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

/**
 * Complete parse of the app directory
 */
export function parseAppRouter(options: PluginOptions = {}): {
    routes: ParsedRoute[];
    intercepts: InterceptedRoute[];
    tree: RouteNode[];
    rootLayout?: string;
    rootPage?: string;
    rootError?: string;
    rootLoading?: string;
    rootNotFound?: string;
    /** Parallel-route slots owned by the app root segment. */
    rootSlots?: ParallelSlot[];
} {
    const appDir = options.appDir || 'src/app';
    const extensions = options.extensions || DEFAULT_EXTENSIONS;

    const sharedRegistry = discoverSharedModules(appDir, extensions);
    const scanResult = scanAppDirectoryWithSlots(appDir, extensions, '', {
        routeAncestors: [],
        sharedRegistry,
    });
    const tree = scanResult.nodes;
    const rootSlots = scanResult.slots;
    const root = getRootPage(appDir, extensions);
    const { routes, intercepts } = flattenRoutes(
        tree,
        { layouts: [], layoutNotFoundMap: new Map() },
        root
    );

    // Build the root layoutNotFoundMap
    const rootLayoutNotFoundMap = new Map<string, string>();
    if (root.layoutPath && root.notFoundPath) {
        rootLayoutNotFoundMap.set(root.layoutPath, root.notFoundPath);
    }

    // Add the root route if it exists
    if (root.pagePath) {
        routes.unshift({
            pattern: '/',
            pagePath: root.pagePath,
            layouts: root.layoutPath ? [root.layoutPath] : [],
            loadingPath: root.loadingPath,
            errorPath: root.errorPath,
            notFoundPath: root.notFoundPath,
            layoutNotFoundMap: rootLayoutNotFoundMap,
        });
    }

    return {
        routes,
        intercepts,
        tree,
        rootLayout: root.layoutPath,
        rootPage: root.pagePath,
        rootError: root.errorPath,
        rootLoading: root.loadingPath,
        rootNotFound: root.notFoundPath,
        ...(rootSlots.length > 0 ? { rootSlots } : {}),
    };
}
