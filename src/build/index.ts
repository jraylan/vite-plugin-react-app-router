/**
 * Build mode handler
 * Generates routes statically for bundle inclusion
 */

import type { PluginHookHandler } from "../commons/types.js";
import type { ResolvedConfig } from "vite";
import { parseAppRouter, generateBuildRoutesCode, generateEmptyRoutesCode, type PluginOptions } from "../commons/index.js";
import * as path from "path";
import * as fs from "fs";

const VIRTUAL_MODULE_ID = "virtual:app-router";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID + ".js";

interface BuildContext {
    config?: ResolvedConfig;
    options: PluginOptions;
    generatedCode?: string;
}

const ctx: BuildContext = {
    options: {},
};

/**
 * Generates the routes code for build
 */
function generateRoutes(): string {
    if (!ctx.config) {
        return generateEmptyRoutesCode();
    }

    const rootDir = ctx.config.root;
    const appDir = ctx.options.appDir || path.join(rootDir, "src/app");

    if (!fs.existsSync(appDir)) {
        console.warn(`[vite-plugin-react-app-router] App directory not found: ${appDir}`);
        return generateEmptyRoutesCode();
    }

    const { routes, rootNotFound } = parseAppRouter({
        ...ctx.options,
        appDir,
    });

    // In build, we use static imports for better tree-shaking
    ctx.generatedCode = generateBuildRoutesCode(routes, { rootDir, lazy: false, rootNotFound });
    return ctx.generatedCode;
}

const buildHandler: PluginHookHandler = {
    configResolved(config: ResolvedConfig) {
        ctx.config = config;

        // Pre-generate routes during build
        generateRoutes();
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
        return ctx.generatedCode || generateRoutes();
    }
    return undefined;
}

export const VIRTUAL_ID = VIRTUAL_MODULE_ID;
export const RESOLVED_ID = RESOLVED_VIRTUAL_MODULE_ID;

export default buildHandler;