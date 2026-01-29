/**
 * Development mode handler (serve)
 * Implements JIT route generation via virtual module
 */

import type { PluginHookHandler } from "../commons/types.js";
import type { ResolvedConfig, ViteDevServer, HmrContext } from "vite";
import { parseAppRouter, generateDevRoutesCode, generateEmptyRoutesCode, type PluginOptions } from "../commons/index.js";
import * as path from "path";
import * as fs from "fs";

const VIRTUAL_MODULE_ID = "virtual:app-router";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID + ".js";

interface ServerContext {
    config?: ResolvedConfig;
    server?: ViteDevServer;
    options: PluginOptions;
    cachedCode?: string;
    appDir?: string;
}

const ctx: ServerContext = {
    options: {},
};

/**
 * Regenerates the routes code
 */
function regenerateRoutes(): string {
    if (!ctx.config) {
        return generateEmptyRoutesCode();
    }

    const rootDir = ctx.config.root;
    const appDir = ctx.options.appDir || path.join(rootDir, "src/app");
    ctx.appDir = appDir;

    if (!fs.existsSync(appDir)) {
        console.warn(`[vite-plugin-react-app-router] App directory not found: ${appDir}`);
        return generateEmptyRoutesCode();
    }

    const { routes } = parseAppRouter({
        ...ctx.options,
        appDir,
    });

    ctx.cachedCode = generateDevRoutesCode(routes, { rootDir, lazy: true });
    return ctx.cachedCode;
}

/**
 * Checks if a file is inside the app directory
 */
function isAppFile(filePath: string): boolean {
    if (!ctx.appDir) return false;
    const normalizedPath = path.normalize(filePath);
    const normalizedAppDir = path.normalize(ctx.appDir);
    return normalizedPath.startsWith(normalizedAppDir);
}

/**
 * Checks if it's a route file (page, layout, etc.)
 */
function isRouteFile(filePath: string): boolean {
    const basename = path.basename(filePath);
    const routeFiles = ["page", "layout", "loading", "error", "not-found"];
    return routeFiles.some(rf => basename.startsWith(rf));
}

const serverHandler: PluginHookHandler = {
    configResolved(config: ResolvedConfig) {
        ctx.config = config;
    },

    configureServer(server: ViteDevServer) {
        ctx.server = server;

        // Add virtual module resolution
        return () => {
            // Middleware not needed, we use resolveId and load
        };
    },

    handleHotUpdate(hmrCtx: HmrContext) {
        const { file, server } = hmrCtx;

        // If a route file was modified, invalidate the virtual module
        if (isAppFile(file) && isRouteFile(file)) {
            // Clear the cache
            ctx.cachedCode = undefined;

            // Invalidate the virtual module for regeneration
            const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
            if (mod) {
                server.moduleGraph.invalidateModule(mod);

                // Send HMR update
                server.ws.send({
                    type: "full-reload",
                    path: "*",
                });
            }
        }
    },
};

// Export functions for use in the main plugin
export function resolveId(id: string): string | undefined {
    if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
    }
    return undefined;
}

export function load(id: string): string | undefined {
    if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        return regenerateRoutes();
    }
    return undefined;
}

export const VIRTUAL_ID = VIRTUAL_MODULE_ID;
export const RESOLVED_ID = RESOLVED_VIRTUAL_MODULE_ID;

export default serverHandler;