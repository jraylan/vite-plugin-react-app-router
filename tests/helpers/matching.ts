/**
 * Matching helpers built on react-router's own matcher, so the assertions
 * measure what the consumer's router does — not a re-implementation of route
 * ranking that could agree with the bug.
 */

import { matchRoutes, type RouteObject } from 'react-router';
import { describeRoute, type RouteEntry } from './routeTable.js';

/** The chain of routes react-router walks to reach `url`, root first. */
export function matchChain(routes: RouteEntry[], url: string): RouteEntry[] {
    return matchRoutes(routes as RouteObject[], url)?.map((m) => m.route as RouteEntry) ?? [];
}

/** The path of the leaf route that renders at `url` (undefined when unmatched). */
export function leafPath(routes: RouteEntry[], url: string): string | undefined {
    const chain = matchChain(routes, url);
    return chain.length === 0 ? undefined : chain[chain.length - 1]!.path;
}

/** Readable rendering of the matched chain, for failure messages. */
export function drawChain(routes: RouteEntry[], url: string): string {
    const chain = matchChain(routes, url);
    if (chain.length === 0) return 'no route matched';
    return chain.map(describeRoute).join(' > ');
}

/** True when the leaf that renders at `url` is exactly `route`. */
export function leafIs(routes: RouteEntry[], url: string, route: RouteEntry): boolean {
    const chain = matchChain(routes, url);
    return chain.length > 0 && chain[chain.length - 1] === route;
}

/** Finds a route by its exact `path` anywhere in the table. */
export function findByPath(routes: RouteEntry[], target: string): RouteEntry | undefined {
    for (const route of routes) {
        if (route.path === target) return route;
        if (route.children) {
            const found = findByPath(route.children, target);
            if (found) return found;
        }
    }
    return undefined;
}
