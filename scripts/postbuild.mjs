#!/usr/bin/env node
/**
 * Auto-configures the consumer project on install:
 *   1. Adds "vite-plugin-react-app-router/types" to compilerOptions.types in
 *      tsconfig.app.json (preferred) or tsconfig.json.
 *   2. Prepends /// <reference types="vite-plugin-react-app-router/types" />
 *      to src/vite-env.d.ts (preferred) or vite-env.d.ts.
 *
 * The script is idempotent and best-effort: any failure is logged as a warning
 * but never breaks the install.
 */

import fs from 'node:fs';
import path from 'node:path';

function main() {
    fs.copyFileSync(
        path.join("src", 'virtual-module.d.ts'),
        path.join("dist", 'virtual-module.d.ts')
    )
}

try {
    main();
} catch (err) {
    console.warn(`unexpected error during postbuild: ${err.message}`);
}
