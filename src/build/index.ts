/**
 * Build mode handler
 * Generates routes statically for bundle inclusion
 */

import type { PluginHookHandler } from "../commons/types.ts";
import type { ResolvedConfig } from "vite";
import { parseAppRouter, generateBuildRoutesCode, type PluginOptions } from "../commons/index.ts";
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
        return 'export default function AppRouter() { return null; }';
    }

    const rootDir = ctx.config.root;
    const appDir = ctx.options.appDir || path.join(rootDir, "src/app");

    if (!fs.existsSync(appDir)) {
        console.warn(`[vite-plugin-react-app-router] App directory not found: ${appDir}`);
        return `
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

const router = createBrowserRouter([]);

export function AppRouter() {
    return <RouterProvider router={router} />;
}

export default AppRouter;
`;
    }

    const { routes } = parseAppRouter({
        ...ctx.options,
        appDir,
    });

    // In build, we use static imports for better tree-shaking
    ctx.generatedCode = generateBuildRoutesCode(routes, { rootDir, lazy: false });
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