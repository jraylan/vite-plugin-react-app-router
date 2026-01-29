/**
 * vite-plugin-react-app-router
 * 
 * Vite plugin that brings Next.js App Router to standard React projects.
 * Generates react-router-dom routes dynamically based on directory structure.
 */

import type { Plugin } from 'vite';
import type { PluginOptions } from './commons/types.js';

// Import handlers and resolution functions
import * as serverModule from './server/index.js';
import * as buildModule from './build/index.js';

// Re-export types from virtual module so client projects have access
export type { PluginOptions } from './commons/types.js';

// Virtual module ID constant for external use
export const VIRTUAL_MODULE_ID = 'virtual:app-router';

interface PluginContext {
    options: PluginOptions;
    handler?: typeof serverModule.default | typeof buildModule.default;
}

export default function reactAppRouterPlugin(options: PluginOptions = {}): Plugin {

    const context: PluginContext = {
        options,
    };

    let currentModule: typeof serverModule | typeof buildModule;

    return {
        name: 'vite-plugin-react-app-router',

        // Ensure this plugin runs before others
        enforce: 'pre',

        config(config, env) {
            // Determine which module to use based on command (serve or build)
            currentModule = env.command === 'serve' ? serverModule : buildModule;
            context.handler = currentModule.default;

            if (context.handler?.config) {
                return context.handler.config.bind(this)(config, env);
            }
        },

        async configResolved(config) {
            if (context.handler?.configResolved) {
                return context.handler.configResolved.bind(this)(config);
            }
        },

        configEnvironment(name, config, env) {
            if (context.handler?.configEnvironment) {
                return context.handler.configEnvironment.bind(this)(name, config, env);
            }
        },

        configureServer(server) {
            if (context.handler?.configureServer) {
                return context.handler.configureServer.bind(this)(server);
            }
        },

        configurePreviewServer(server) {
            if (context.handler?.configurePreviewServer) {
                return context.handler.configurePreviewServer.bind(this)(server);
            }
        },

        // Resolve the virtual module "virtual:app-router"
        resolveId(id) {
            if (currentModule?.resolveId) {
                return currentModule.resolveId(id);
            }
        },

        // Load virtual module content (generated routes code)
        load(id) {
            if (currentModule?.load) {
                return currentModule.load(id);
            }
        },

        handleHotUpdate(ctx) {
            if (context.handler?.handleHotUpdate) {
                return context.handler.handleHotUpdate.bind(this)(ctx);
            }
        },

        async buildApp(app) {
            if (context.handler?.buildApp) {
                return await context.handler.buildApp.bind(this)(app);
            }
        },
    }
}
